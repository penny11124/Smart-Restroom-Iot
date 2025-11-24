// 全域變數，用來存圖表實例，切換時才不會重複畫圖
let usageChartInstance = null;
let energyChartInstance = null;

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
        ],
        // 電力感測器
        powerConfig: {
            voltage: { type: "BATTERY_VOLTAGE", id: "ec90c93e-c304-436f-aa6c-1f4a9739f78b" }, 
            current: { type: "ELECTRIC_CURRENT", id: "1c788f5f-0e3e-4297-84cd-a66b7d3d9562" }
        }
    },
    {
        name: "隔間 2",
        // 壓力感測器
        pressureSensor: { type: "BATTERY_VOLTAGE", id: "ec90c93e-c304-436f-aa6c-1f4a9739f78b" },
        // 空氣感測器
        airSensors: [
            { name: "eCO2", type: "AIR_PRESS", id: "1d3a465b-d312-4f12-b24a-d818676bd6ca" }
        ],
        // 電力感測器
        powerConfig: {
            voltage: { type: "BATTERY_VOLTAGE", id: "ec90c93e-c304-436f-aa6c-1f4a9739f78b" },
            current: { type: "ELECTRIC_CURRENT", id: "1c788f5f-0e3e-4297-84cd-a66b7d3d9562" }
        }
    }
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

async function openEnergyReport() {
    const modal = document.getElementById('energy-modal');
    modal.style.display = 'flex';
    
    document.getElementById('esg-kwh').innerText = '計算中...';
    document.getElementById('esg-carbon').innerText = '-';
    document.getElementById('esg-rate').innerText = '-';

    try {
        let totalSmartKwh = 0;      
        let totalTraditionalKwh = 0;
        const CO2_FACTOR = 0.495;   

        for (const stall of STALLS_CONFIG) {
            
            // 1. 抓取電壓與電流歷史
            const [voltageRes, currentRes] = await Promise.all([
                fetch(`/api/sensor-history?type=${stall.powerConfig.voltage.type}&id=${stall.powerConfig.voltage.id}`).then(r => r.json()),
                fetch(`/api/sensor-history?type=${stall.powerConfig.current.type}&id=${stall.powerConfig.current.id}`).then(r => r.json())
            ]);

            // 2. 計算平均電壓 (通常電壓是穩定的)
            const avgVolts = calculateAverage(voltageRes.Items);

            // 3. 【關鍵】推算電流
            const currentItems = currentRes.Items || [];
            if (currentItems.length === 0) continue;

            // A. 實際電流平均 (智慧模式)
            // 這是整天下來真正的平均耗電
            const avgActualAmps = calculateAverage(currentItems);

            // B. 推算「全開」時的電流 (傳統模式)
            // 邏輯：找出數值最大的前 20% 數據，平均起來當作「設備全開」的狀態
            // 排序：由大到小
            const sortedCurrents = currentItems.map(i => parseFloat(i.value)).sort((a, b) => b - a);
            // 取前 20% (如果資料太少至少取 1 筆)
            const topCount = Math.ceil(sortedCurrents.length * 0.2); 
            const topCurrents = sortedCurrents.slice(0, topCount);
            // 算出這些「高峰期」的平均電流
            const activeStateAmps = topCurrents.reduce((a, b) => a + b, 0) / topCount;

            // 4. 轉換成功率 (kW)
            // P = V * I / 1000
            const actualPowerKw = (avgVolts * avgActualAmps) / 1000;
            const traditionalPowerKw = (avgVolts * activeStateAmps) / 1000;

            // 5. 累加耗電量 (假設一天 24 小時)
            // 傳統：假設整天都維持「全開」的高耗電
            totalTraditionalKwh += (traditionalPowerKw * 24);
            
            // 智慧：實際測量到的耗電
            totalSmartKwh += (actualPowerKw * 24);
        }

        // 避免數據太小或異常導致負數 (防呆)
        if (totalTraditionalKwh < totalSmartKwh) totalTraditionalKwh = totalSmartKwh;

        // 結算
        const savedKwh = totalTraditionalKwh - totalSmartKwh;
        const savedCarbon = savedKwh * CO2_FACTOR;
        const savingRate = totalTraditionalKwh > 0 ? (savedKwh / totalTraditionalKwh) * 100 : 0;

        // 更新畫面
        document.getElementById('esg-kwh').innerText = savedKwh.toFixed(3);
        document.getElementById('esg-carbon').innerText = savedCarbon.toFixed(3);
        document.getElementById('esg-rate').innerText = savingRate.toFixed(1);

        renderEnergyChart(totalTraditionalKwh, totalSmartKwh);

    } catch (err) {
        console.error(err);
        document.getElementById('esg-kwh').innerText = "Error";
    }
}

// 輔助：計算陣列平均
function calculateAverage(items) {
    if (!items || items.length === 0) return 0;
    let sum = 0;
    let count = 0;
    items.forEach(item => {
        const val = parseFloat(item.value);
        if (!isNaN(val)) {
            sum += val;
            count++;
        }
    });
    return count > 0 ? sum / count : 0;
}

// 繪製節能比較圖
function renderEnergyChart(trad, smart) {
    const canvas = document.getElementById('energyChart');
    const ctx = canvas.getContext('2d');
    
    // 使用 .chart-container-box 的 CSS 控制，不需要 JS 設定高度
    
    if (energyChartInstance) energyChartInstance.destroy();

    let gradientTrad = ctx.createLinearGradient(0, 0, 0, 350);
    gradientTrad.addColorStop(0, '#6c757d'); 
    gradientTrad.addColorStop(1, '#adb5bd');

    let gradientSmart = ctx.createLinearGradient(0, 0, 0, 350);
    gradientSmart.addColorStop(0, '#28a745'); 
    gradientSmart.addColorStop(1, '#81c784');

    energyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['傳統模式 (24H全開)', '本智慧系統'],
            datasets: [{
                label: '每日耗電量 (kWh)',
                data: [trad, smart],
                backgroundColor: [gradientTrad, gradientSmart],
                borderRadius: 10,
                barThickness: 80
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) { return `耗電: ${context.parsed.y.toFixed(3)} kWh`; }
                    }
                }
            },
            scales: {
                y: { 
                    beginAtZero: true, 
                    title: { display: true, text: '耗電量 (kWh)' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}
// --- 2. 新增：開啟詳細視窗的函式 ---
async function openModal(stallName) {
    const model = document.getElementById('detail-modal');
    const title = document.getElementById('modal-title');

    // 顯示 Loading 狀態
    model.style.display = 'flex';
    title.innerText = `${stallName} - 數據詳情`;
    document.getElementById('stat-count').innerText = '-';
    document.getElementById('stat-avg').innerText = '-';

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
        document.getElementById('stat-avg').innerText = analysis.avgDuration.toFixed(1) + " 分";

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

// --- 4. 畫圖表函式 (改為折線圖) ---
function renderChart(hourlyData) {
    const canvas = document.getElementById('usageChart');
    const ctx = canvas.getContext('2d');

    // 2. 銷毀舊圖表
    if (usageChartInstance) {
        usageChartInstance.destroy();
    }

    // createLinearGradient(x0, y0, x1, y1) -> 從上(0)到下(300)
    let gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(0, 123, 255, 0.6)');  // 頂部：較深的藍色 (60%透明)
    gradient.addColorStop(1, 'rgba(0, 123, 255, 0.05)'); // 底部：幾乎透明 (5%透明)

    const labels = Array.from({length: 24}, (_, i) => `${i}:00`);

    usageChartInstance = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: labels,
            datasets: [{
                label: '使用人次',
                data: hourlyData,
                // 線條設定
                borderColor: '#007bff',       
                borderWidth: 3,
                backgroundColor: gradient, 
                fill: true,                   
                tension: 0.4, // 圓滑曲線
                
                // 點的設定 (平時隱藏點，滑鼠移上去才變大，看起來更乾淨)
                pointRadius: 0, 
                pointHoverRadius: 6,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#007bff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            
            interaction: {
                mode: 'index',   // 滑鼠在該 X 軸上就會顯示，不用對準點
                intersect: false,
            },
            
            plugins: { 
                legend: { display: false }, // 隱藏圖例
                tooltip: {
                    backgroundColor: 'rgba(30, 30, 30, 0.9)', // 深色提示框
                    titleFont: { size: 14 },
                    bodyFont: { size: 16, weight: 'bold' },
                    padding: 10,
                    displayColors: false, // 隱藏提示框裡的小色塊
                    callbacks: {
                        // 自定義提示文字
                        label: function(context) {
                            return `使用量: ${context.parsed.y} 人次`;
                        }
                    }
                }
            },
            
            scales: {
                y: { 
                    beginAtZero: true, 
                    ticks: { 
                        stepSize: 1,
                        color: '#888' // 文字顏色淡一點
                    },
                    grid: { 
                        color: '#eee',
                        borderDash: [5, 5]
                    }
                },
                x: {
                    grid: { display: false }, // 隱藏 X 軸網格
                    ticks: {
                        color: '#888',
                        // 避免 X 軸太擠，自動略過一些標籤
                        autoSkip: true,
                        maxTicksLimit: 13
                    }
                }
            },
            // 加入一點進場動畫
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });
}

// 關閉視窗 (支援多個 Modal)
function closeModal(modalId) {
    const id = modalId || 'detail-modal'; // 相容舊寫法
    document.getElementById(id).style.display = 'none';
}

// 點擊外部關閉
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = "none";
    }
}
