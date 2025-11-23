// 全域變數，用來存圖表實例，切換時才不會重複畫圖
let usageChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    // 立即執行一次，然後每 5 秒鐘更新一次
    updateDashboard();
    setInterval(updateDashboard, 5000); 
});

// ==========================================================
// 定義廁所隔間，填入type和ID
// ==========================================================
const STALLS_CONFIG = [
    {
        name: "隔間 1",
        // 壓力感測器
        pressureSensor: { type: "ELECTRIC_CURRENT", id: "1c788f5f-0e3e-4297-84cd-a66b7d3d9562" },
        // 空氣感測器
        airSensors: [
            { name: "eCO2", type: "AIR_PRESS", id: "1d3a465b-d312-4f12-b24a-d818676bd6ca" }
        ]
    },
    {
        name: "隔間 2",
        // 壓力感測器
        pressureSensor: { type: "BATTERY_VOLTAGE", id: "ec90c93e-c304-436f-aa6c-1f4a9739f78b" },
        // 空氣感測器
        airSensors: [
            { name: "eCO2", type: "AIR_PRESS", id: "1d3a465b-d312-4f12-b24a-d818676bd6ca" }
        ]
    }
    // ... 在此新增更多隔間
];


/**
 * 主要函式：更新整個儀表板
 */
async function updateDashboard() {
    // console.log('--- 開始更新儀表板 ---');
    const container = document.getElementById('dashboard-container');

    // 建立一個 Promise 陣列，來處理所有隔間的資料請求
    const fetchAllStallsDataPromises = STALLS_CONFIG.map(stall => {
        return fetchStallData(stall);
    });

    try {
        const stallsHtmlArray = await Promise.all(fetchAllStallsDataPromises);
        container.innerHTML = stallsHtmlArray.join('');

    } catch (error) {
        console.error('更新儀表板時發生錯誤:', error);
        container.innerHTML = `<h2>錯誤</h2><p style="color: red;">無法載入儀表板資料。</p>`;
    }
}

/**
 * 輔助函式：取得「單一隔間」的所有資料，並回傳 HTML 字串
 * @param {object} stallConfig - 單一隔間的設定物件
 * @returns {Promise<string>} - 組合好的 HTML 卡片字串
 */
async function fetchStallData(stallConfig) {
    try {
        // 1. 取得壓力感測器「狀態」
        const pressureData = await fetchSensorData(stallConfig.pressureSensor.type, stallConfig.pressureSensor.id);

        // 2. 取得 eCO2 感測器「狀態」
        const airSensorsPromises = stallConfig.airSensors.map(sensor => 
            fetchSensorData(sensor.type, sensor.id).then(data => ({
                name: sensor.name, 
                ...data 
            }))
        );
        const airSensorsData = await Promise.all(airSensorsPromises);

        // 3. 組合 HTML
        return generateStallCardHtml(stallConfig.name, pressureData, airSensorsData);

    } catch (error) {
        console.error(`取得 ${stallConfig.name} 資料失敗:`, error);
        // 如果單一隔間失敗，回傳一個錯誤卡片
        return `
            <div class="stall-card error">
                <div class="stall-status">連線失敗</div>
                <div class="stall-content">
                    <h3>${stallConfig.name}</h3>
                    <p style="color: red;">無法載入此隔間數據</p>
                </div>
            </div>`;
    }
}

/**
 * 輔助函式：呼叫後端 API 取得單一感測器的狀態
 * @param {string} type - 感測器類型
 * @param {string} id - 感測器 ID
 * @returns {Promise<object>} - 包含狀態和顯示數值的物件 (例如: { status: "idle", displayValue: "0.5 kg" })
 */
async function fetchSensorData(type, id) {
    // 呼叫我們在後端建立的 /api/sensor-data 路由
    const SENSOR_DATA_API = `/api/sensor-data?type=${type}&id=${id}`;

    try {
        const response = await fetch(SENSOR_DATA_API);
        if (!response.ok) {
            console.error(`取得 ${type} (${id}) 資料失敗`);
            return { status: "error", displayValue: "Error" };
        }
        return await response.json(); // 這會回傳 { status: "...", displayValue: "..." }

    } catch (error) {
        console.error(`呼叫 /api/sensor-data (type: ${type}) 時發生網路錯誤:`, error);
        return { status: "error", displayValue: "Error" };
    }
}


/**
 * 輔助函式：產生單張卡片的 HTML
 * @param {string} name - 隔間名稱
 * @param {object} pressureData - 壓力感測器狀態物件
 * @param {Array<object>} airSensorsData - 空氣感測器狀態物件陣列
 * @returns {string} - HTML 字串
 */
function generateStallCardHtml(name, pressureData, airSensorsData) {
    
    // 決定卡片的 CSS class (idle, in-use, eco-mode, error)
    const cardStatusClass = pressureData.status || 'error';
    
    // 決定顯示的狀態文字
    let statusText = "錯誤";
    switch (pressureData.status) {
        case "idle":
            statusText = "閒置中";
            break;
        case "in-use":
            statusText = "使用中";
            break;
        case "eco-mode":
            statusText = "節能模式";
            break;
    }

    // 產生 eCO2 的 HTML
    const airSensorsHtml = airSensorsData.map(sensor => `
        <li>
            <strong>${sensor.name}</strong>
            <span class="${sensor.status || ''}">${sensor.displayValue}</span>
        </li>
    `).join('');

    // 組合完整的卡片 HTML
    return `
        <div class="stall-card ${cardStatusClass}" onclick="openModal('${name}')">
            <div class="stall-status">${statusText}</div>
            <div class="stall-content">
                <h3>${name}</h3>
                <ul class="sensor-data">
                    <li>
                        <strong>壓力</strong>
                        <span>${pressureData.displayValue}</span>
                    </li>
                    ${airSensorsHtml}
                </ul>
                <div style="text-align:center; margin-top:10px; color:#888; font-size:0.8rem;">
                    (點擊查看詳細統計)
                </div>
            </div>
        </div>
    `;
}

// --- 2. 新增：開啟詳細視窗的函式 ---
async function openModal(stallName) {
    const model = document.getElementById('detail-modal');
    const title = document.getElementById('modal-title');

    // 顯示 Loading 狀態
    model.style.display = 'flex';
    title.innerText = `${stallName} - 數據詳情`;
    document.getElementById('stat-count').innerText = '-';
    document.getElementById('stat-avg-time').innerText = '-';

    // 1. 根據名稱找到對應的設定 (從 STALLS_CONFIG 找)
    const stallConfig = STALLS_CONFIG.find(s => s.name === stallName);
    if (!stallConfig) return;

    title.innerText = `${stallName} - 24小時使用分析`;

    // 2. 呼叫後端取得24小時歷史資料
    try {
        const res = await fetch(`/api/sensor-history?type=${stallConfig.pressureSensor.type}&id=${stallConfig.pressureSensor.id}`);
        const data = await res.json();
        
        if (!data.Items) throw new Error("無數據");

        // 3. 進行數據分析 (演算法)
        const analysis = analyzeUsage(data.Items);

        // 4. 更新畫面上數字
        document.getElementById('stat-count').innerText = analysis.totalCount + " 次";
        document.getElementById('stat-avg-time').innerText = analysis.avgDuration.toFixed(1) + " 分";

        // 5. 畫圖表
        renderChart(analysis.hourlyCounts);

    } catch (err) {
        console.error(err);
        title.innerText = "數據載入失敗";
    }
}

// --- 3. 核心演算法：分析原始數據 ---
function analyzeUsage(items) {
    // items 是 { value: "...", timestamp: "..." } 的陣列
    let usageCount = 0;
    let totalDurationSec = 0;
    let hourlyCounts = new Array(24).fill(0); // 0點到23點的計數器

    let isOccupied = false;
    let startTime = 0;
    const THRESHOLD = 5; // 5kg 以上算有人

    // 按照時間順序跑迴圈
    items.forEach(item => {
        const val = parseFloat(item.value);
        const time = new Date(item.timestamp); // ISO 字串轉時間物件
        const hour = time.getHours();

        if (val >= THRESHOLD) {
            // 如果現在有人，且之前沒人 -> 新的使用開始
            if (!isOccupied) {
                isOccupied = true;
                startTime = time.getTime();
                usageCount++;
                hourlyCounts[hour]++; // 該時段次數+1
            }
        } else {
            // 如果現在沒人，且之前有人 -> 使用結束
            if (isOccupied) {
                isOccupied = false;
                const duration = (time.getTime() - startTime) / 1000; // 秒
                // 過濾掉太短的誤判 (例如小於 10 秒)
                if (duration > 10) {
                    totalDurationSec += duration;
                } else {
                    // 如果太短，把剛剛加的次數扣回來 (視為雜訊)
                    usageCount--; 
                    hourlyCounts[hour]--;
                }
            }
        }
    });

    const avgDuration = usageCount > 0 ? (totalDurationSec / 60) / usageCount : 0; // 分鐘

    return {
        totalCount: usageCount,
        avgDuration: avgDuration,
        hourlyCounts: hourlyCounts
    };
}

// --- 4. 畫圖表函式 (Chart.js) ---
function renderChart(hourlyData) {
    const ctx = document.getElementById('usageChart').getContext('2d');

    // 如果舊圖表還在，先銷毀它
    if (usageChartInstance) {
        usageChartInstance.destroy();
    }

    // 產生 0~23 的標籤
    const labels = Array.from({length: 24}, (_, i) => `${i}:00`);

    usageChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '每小時使用次數',
                data: hourlyData,
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });
}

// --- 5. 關閉視窗 ---
function closeModal() {
    document.getElementById('detail-modal').style.display = 'none';
}

// 點擊視窗外部也可以關閉
window.onclick = function(event) {
    const modal = document.getElementById('detail-modal');
    if (event.target == modal) {
        modal.style.display = "none";
    }
}