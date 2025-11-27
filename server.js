const express = require('express');
const fetch = require('node-fetch');
const { URLSearchParams } = require('url');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// --- API 基礎設定 ---
const API_BASE_URL = 'https://edu.nthu-smart-farming.kits.tw/api/api';
const LOGIN_API = `${API_BASE_URL}/account/login`;

// API: 取得單一感測器的歷史區間資料
// 格式: /sensors_in_timeinterval/{sensorType}/{sensorId}/{start}/{end}
const SENSOR_DATA_API_URL = `${API_BASE_URL}/sensors_in_timeinterval`;

const USER_ACCOUNT = '2025-competition-team10';
const USER_PASSWORD = '94964689';

// --- 中介軟體 (Middleware) ---
app.use(cors());
app.use(express.static(__dirname));

// --- 輔助函式：取得 Token ---
async function getAuthToken() {
    // console.log('正在嘗試登入並取得 Token...');
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
    
    // console.log('成功取得Token');
    return loginData.token;
}

// --- API 1: 即時監控 (計算使用時間與狀態) ---
app.get('/api/sensor-data', async (req, res) => {
    const { type, id } = req.query;
    if (!type || !id) return res.status(400).json({ message: '缺少參數' });

    try {
        const token = await getAuthToken();
        const endTimestamp = Date.now();
        // 抓取過去 30 分鐘的資料，以便計算持續時間
        const startTimestamp = endTimestamp - (30 * 60 * 1000);
        
        const sensorApiUrl = `${SENSOR_DATA_API_URL}/${type}/${id}/${startTimestamp}/${endTimestamp}`;
        const sensorResponse = await fetch(sensorApiUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        const sensorData = await sensorResponse.json();
        const items = sensorData.Items || [];

        if (items.length === 0) {
            return res.status(200).json({ status: "error", displayValue: "N/A", rawValue: 0 });
        }

        // 取得最新一筆
        const latestItem = items[items.length - 1];
        const latestValue = parseFloat(latestItem.value);

        // 判斷感測器類型來決定邏輯
        // 根據你的 script.js，壓力感測器用了 ELECTRIC_CURRENT, BATTERY_VOLTAGE, WEIGHT_SCALE
        const isPressureSensor = ['ELECTRIC_CURRENT', 'BATTERY_VOLTAGE', 'WEIGHT_SCALE'].includes(type);
        
        if (isPressureSensor) {
            // === 壓力/使用狀態邏輯 ===
            const THRESHOLD = 5; // 閾值 (大於此值視為有人)
            const ECO_MODE_LIMIT = 10; // 超過 10 分鐘視為節能模式/久佔

            if (latestValue < THRESHOLD) {
                // 沒人
                return res.status(200).json({
                    status: "idle",
                    displayValue: "N/A",
                    rawValue: latestValue // 回傳原始數值給前端 debug
                });
            } else {
                // 有人，計算持續時間
                let startTime = latestItem.timestamp;
                // 往回找，直到找到數值 < THRESHOLD 的那一點
                for (let i = items.length - 2; i >= 0; i--) {
                    const val = parseFloat(items[i].value);
                    if (val < THRESHOLD) {
                        break; // 找到斷點了
                    }
                    startTime = items[i].timestamp; // 更新開始時間
                }

                const durationMs = latestItem.timestamp - startTime;
                const durationMin = Math.floor(durationMs / 1000 / 60); // 轉分鐘

                let status = "in-use";
                if (durationMin >= ECO_MODE_LIMIT) status = "eco-mode"; // 久佔顯示黃色

                return res.status(200).json({
                    status: status,
                    displayValue: `${durationMin} 分鐘`, // 前端顯示這個
                    rawValue: latestValue // Debug 用
                });
            }

        } else {
            // === 空氣品質邏輯 (eCO2) ===
            let status = "good";
            if (latestValue > 1500) status = "bad";
            else if (latestValue > 1000) status = "moderate";

            return res.status(200).json({
                status: status,
                displayValue: `${latestValue.toFixed(0)} ppm`,
                rawValue: latestValue
            });
        }

    } catch (error) {
        console.error('API Error:', error.message);
        res.status(500).json({ status: "error", displayValue: "Error", message: error.message });
    }
});;

// --- API 2: 24小時歷史資料 ---
app.get('/api/sensor-history', async (req, res) => {
    const { type, id } = req.query;
    
    if (!type || !id) return res.status(400).json({ message: '缺少參數' });

    try {
        const token = await getAuthToken();
        
        const endTimestamp = Date.now();
        const startTimestamp = endTimestamp - (24 * 60 * 60 * 1000); // 24 小時前

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

// --- API 3: 7天歷史資料 (用於AI預測) ---
app.get('/api/sensor-history-7days', async (req, res) => {
    const { type, id } = req.query;
    if (!type || !id) return res.status(400).json({ message: '缺少參數' });

    try {
        const token = await getAuthToken();
        const endTimestamp = Date.now();
        // 7 天 = 7 * 24 * 60 * 60 * 1000
        const startTimestamp = endTimestamp - (7 * 24 * 60 * 60 * 1000);

        const sensorApiUrl = `${SENSOR_DATA_API_URL}/${type}/${id}/${startTimestamp}/${endTimestamp}`;
        const response = await fetch(sensorApiUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        // 因為 7 天資料量可能很大，建議可以在這裡做一點簡單的採樣 (Sampling) 以減少傳輸量
        // 但為了準確度，我們先回傳全部
        res.status(200).json(data);
    } catch (error) {
        console.error('取得7天歷史資料失敗:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- 啟動伺服器 ---
app.listen(PORT, () => {
    console.log(`後端伺服器已啟動！`);
    console.log(`你的Web App現在跑在 http://localhost:${PORT}`);
    console.log('---');
    console.log(`提供 API 網址:`);
    console.log(`1. 感測器清單: http://localhost:${PORT}/api/sensorGroup`);
    console.log(`2. 感測器資料: http://localhost:${PORT}/api/sensor-data?type=...&id=...`);
});