document.addEventListener('DOMContentLoaded', () => {
    // 立即執行一次，然後每 5 秒鐘更新一次
    updateDashboard();
    setInterval(updateDashboard, 5000); 
});

// ==========================================================
// 關鍵設定：定義你的「廁所隔間」
// 你必須在這裡填入你從平台上取得的「感測器類型(type)」和「ID」
// ==========================================================
const STALLS_CONFIG = [
    {
        name: "隔間 1",
        // 壓力感測器
        pressureSensor: { type: "LIGHT_INTENSITY", id: "63e7d0d3-53b1-4e12-baf8-7bd91b871412" },
        // 空氣感測器 (根據你的企劃書，你們有TVOC/eCO2)
        airSensors: [
            { name: "TVOC", type: "tvoc_type_1", id: "YOUR-TVOC-SENSOR-ID-1" }
        ]
    },
    {
        name: "隔間 2",
        pressureSensor: { type: "BATTERY_VOLTAGE", id: "ec90c93e-c304-436f-aa6c-1f4a9739f78b" },
        airSensors: [
            { name: "TVOC", type: "tvoc_type_2", id: "YOUR-TVOC-SENSOR-ID-2" }
        ]
    }
    // ... 在此新增更多隔間
];


/**
 * 主要函式：更新整個儀表板
 */
async function updateDashboard() {
    console.log('--- 開始更新儀表板 ---');
    const container = document.getElementById('dashboard-container');

    // 建立一個 Promise 陣列，來處理所有隔間的資料請求
    const fetchAllStallsDataPromises = STALLS_CONFIG.map(stall => {
        return fetchStallData(stall);
    });

    try {
        // 等待所有隔間的資料都回來
        const stallsHtmlArray = await Promise.all(fetchAllStallsDataPromises);

        // 將所有隔間的 HTML 卡片組合起來，放到頁面上
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

        // 2. 取得所有空氣感測器「狀態」
        const airSensorsPromises = stallConfig.airSensors.map(sensor => 
            fetchSensorData(sensor.type, sensor.id).then(data => ({
                name: sensor.name, // 把感測器名稱(TVOC)一起回傳
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
 * 輔助函式：呼叫後端 API 取得「單一」感測器的「狀態」
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

    // 組合空氣品質的 HTML <li> 字串
    const airSensorsHtml = airSensorsData.map(sensor => `
        <li>
            <strong>${sensor.name}</strong>
            <span class="${sensor.status || ''}">${sensor.displayValue}</span>
        </li>
    `).join('');

    // 組合完整的卡片 HTML
    return `
        <div class="stall-card ${cardStatusClass}">
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
            </div>
        </div>
    `;
}