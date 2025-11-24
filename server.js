const express = require('express');
const fetch = require('node-fetch');
const { URLSearchParams } = require('url');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// --- API 基礎設定 (機敏資料) ---
const API_BASE_URL = 'https://edu.nthu-smart-farming.kits.tw/api/api';
const LOGIN_API = `${API_BASE_URL}/account/login`;

// API 1: 取得「感測器清單」
const SENSOR_GROUP_API_URL = `${API_BASE_URL}/sensors_in_group/6b3359aa-c2ee-4f69-afa9-11a679f951b1`;

// API 2: 取得「單一感測器的歷史區間資料」
// 格式: /sensors_in_timeinterval/{sensorType}/{sensorId}/{start}/{end}
const SENSOR_DATA_API_URL = `${API_BASE_URL}/sensors_in_timeinterval`;

const USER_ACCOUNT = '2025-competition-team10';
const USER_PASSWORD = '94964689';

// --- 中介軟體 (Middleware) ---
app.use(cors());
app.use(express.static(__dirname));

// --- 輔助函式：取得 Token ---
async function getAuthToken() {
    console.log('正在嘗試登入並取得 Token...');
    const loginParams = new URLSearchParams();
    loginParams.append('email', USER_ACCOUNT);
    loginParams.append('password', USER_PASSWORD);

    const loginResponse = await fetch(LOGIN_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: loginParams
    });

    if (!loginResponse.ok) throw new Error(`登入失敗: ${loginResponse.statusText}`);
    const loginData = await loginResponse.json();
    if (!loginData.token) throw new Error('登入成功，但未取得Token');
    
    console.log('成功取得Token');
    return loginData.token;
}

// --- API 路由 1: 取得感測器群組清單 ---
// 前端呼叫: http://localhost:3000/api/sensorGroup
app.get('/api/sensorGroup', async (req, res) => {
    console.log('收到 /api/sensorGroup 請求 (取得感測器清單)...');
    try {
        const token = await getAuthToken();
        
        const sensorResponse = await fetch(SENSOR_GROUP_API_URL, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!sensorResponse.ok) {
            throw new Error(`取得感測器群組資料失敗: ${sensorResponse.statusText}`);
        }

        const sensorData = await sensorResponse.json();
        console.log('成功取得感測器清單並回傳');
        res.status(200).json(sensorData);

    } catch (error) {
        console.error('後端代理 /api/sensorGroup 時發生錯誤:', error.message);
        res.status(500).json({ message: error.message });
    }
});


// --- API 路由 2: 取得單一感測器的最新讀值 (新功能) ---
app.get('/api/sensor-data', async (req, res) => {
    
    const { type, id } = req.query;

    if (!type || !id) {
        return res.status(400).json({ message: '請求失敗，必須提供 "type" 和 "id" 查詢參數。' });
    }
    
    console.log(`收到 /api/sensor-data 請求 (感測器: ${type})`);

    try {
        const token = await getAuthToken();
        
        // 抓取過去 10 分鐘的資料 (跟之前一樣)
        const endTimestamp = Date.now();
        // 重要：為了判斷節能模式，我們需要更長的歷史資料，例如 15分鐘
        const ecoModeCheckDuration = 15 * 60 * 1000; // 15分鐘
        const startTimestamp = endTimestamp - ecoModeCheckDuration; 

        const sensorApiUrl = `${SENSOR_DATA_API_URL}/${type}/${id}/${startTimestamp}/${endTimestamp}`;
        
        const sensorResponse = await fetch(sensorApiUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        if (!sensorResponse.ok) {
            throw new Error(`取得 ${type} 感測器資料失敗: ${sensorResponse.statusText}`);
        }

        const sensorData = await sensorResponse.json(); // 這會回傳 { "Items": [...] }

        if (!sensorData.Items || sensorData.Items.length === 0) {
            // 如果 15 分鐘內沒資料
            return res.status(200).json({ status: "error", displayValue: "N/A" });
        }

        // --- 核心邏輯判斷 ---
        // 取得最新一筆資料
        const latestDataPoint = sensorData.Items[sensorData.Items.length - 1];
        const latestValue = parseFloat(latestDataPoint.value); // 確保是數字

        // 根據感測器類型 (type) 決定回傳的物件
        if (type.includes('WEIGHT_SCALE') || type.includes('BATTERY_VOLTAGE') || type.includes('ELECTRIC_CURRENT')) {
            // --- 這是壓力感測器的邏輯 ---
            const PRESSURE_THRESHOLD = 5; // 假設大於 5kg 算有人
            const ECO_MODE_TIME = 5 * 60 * 1000; // 假設5分鐘

            if (latestValue < PRESSURE_THRESHOLD) {
                // 1. 狀態：閒置
                return res.status(200).json({
                    status: "idle",
                    displayValue: `${latestValue.toFixed(1)} kg`
                });
            } else {
                // 2. 狀態：有人，需判斷是使用中還是節能模式
                
                // 找出這段有人狀態是從什麼時候開始的
                let sessionStartTime = latestDataPoint.timestamp;
                // 從倒數第二筆資料開始往前看
                for (let i = sensorData.Items.length - 2; i >= 0; i--) {
                    const item = sensorData.Items[i];
                    if (parseFloat(item.value) >= PRESSURE_THRESHOLD) {
                        // 如果還是有人，就更新開始時間
                        sessionStartTime = item.timestamp;
                    } else {
                        // 一旦發現沒人的資料，就表示找到起點了，跳出迴圈
                        break;
                    }
                }

                const inUseDuration = latestDataPoint.timestamp - sessionStartTime;

                if (inUseDuration >= ECO_MODE_TIME) {
                    // 3. 狀態：節能模式 (長時間靜止)
                    return res.status(200).json({
                        status: "eco-mode",
                        displayValue: `${latestValue.toFixed(1)} kg`
                    });
                } else {
                    // 4. 狀態：使用中 (正常使用)
                    return res.status(200).json({
                        status: "in-use",
                        displayValue: `${latestValue.toFixed(1)} kg`
                    });
                }
            }

        } else if (type.includes('AIR_PRESS')) {
            // --- 這是 eCO2 的邏輯 ---
            let status = "good";
            if (latestValue > 1000) status = "bad"; // 假設 > 600 ppb 算差
            else if (latestValue > 200) status = "moderate"; // 假設 > 200 ppb 算中等

            return res.status(200).json({
                status: status,
                displayValue: `${latestValue.toFixed(0)} ppm`
            });
        
        } else {
            return res.status(200).json({
                status: "unknown",
                displayValue: latestValue
            });
        }

    } catch (error) {
        console.error(`後端代理 /api/sensor-data (type: ${type}) 時發生錯誤:`, error.message);
        res.status(500).json({ status: "error", displayValue: "Error", message: error.message });
    }
});

// --- API 路由 3: 取得過去 24 小時的歷史資料 ---
app.get('/api/sensor-history', async (req, res) => {
    const { type, id } = req.query;
    
    if (!type || !id) return res.status(400).json({ message: '缺少參數' });

    try {
        const token = await getAuthToken();
        
        const endTimestamp = Date.now();
        const startTimestamp = endTimestamp - (24 * 60 * 60 * 1000); // 24 小時前

        // 呼叫外部 API
        const sensorApiUrl = `${SENSOR_DATA_API_URL}/${type}/${id}/${startTimestamp}/${endTimestamp}`;
        
        const response = await fetch(sensorApiUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        // 直接把整包歷史資料回傳給前端去運算
        res.status(200).json(data);

    } catch (error) {
        console.error('取得歷史資料失敗:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- 啟動伺服器 ---
app.listen(PORT, () => {
    console.log(`後端伺服器已啟動！`);
    console.log(`你的 Web App 現在跑在 http://localhost:${PORT}`);
    console.log('---');
    console.log(`提供 API 網址:`);
    console.log(`1. 感測器清單: http://localhost:${PORT}/api/sensorGroup`);
    console.log(`2. 感測器資料: http://localhost:${PORT}/api/sensor-data?type=...&id=...`);
});