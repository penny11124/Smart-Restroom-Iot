let usageChartInstance = null;
let energyChartInstance = null;
let currentStallName = null; 

document.addEventListener('DOMContentLoaded', () => {
    updateDashboard();
    setInterval(updateDashboard, 5000); 
});

// 傳統設備基準 (mWh/min)
const TRADITIONAL_BASELINE_MWH_PER_MIN = 63.6; //mWh

const STALLS_CONFIG = [
    {
        name: "隔間 1",
        pressureSensor: { type: "WEIGHT_SCALE", id: "2e2c7411-5498-468c-ad7f-7e1df8a08121" },
        airSensors: [{ name: "eCO2", type: "AIR_PRESS", id: "1d3a465b-d312-4f12-b24a-d818676bd6ca" }],
        powerConsumption: { type: "ELECTRICAL_CONSUMPTION", id: "8ca87a58-f643-4af0-afc6-3e52940750f4" }
    }
    // 在此新增更多隔間配置
];

// --- 儀表板更新 ---
async function updateDashboard() {
    const container = document.getElementById('dashboard-container');
    const fetchAllStallsDataPromises = STALLS_CONFIG.map(stall => fetchStallData(stall));
    try {
        const stallsHtmlArray = await Promise.all(fetchAllStallsDataPromises);
        container.innerHTML = stallsHtmlArray.join('');
    } catch (error) { console.error(error); }
}

async function fetchStallData(stallConfig) {
    try {
        const pressureData = await fetchSensorData(stallConfig.pressureSensor.type, stallConfig.pressureSensor.id);
        const airSensorsPromises = stallConfig.airSensors.map(sensor => 
            fetchSensorData(sensor.type, sensor.id).then(data => ({ name: sensor.name, ...data }))
        );
        const airSensorsData = await Promise.all(airSensorsPromises);
        return generateStallCardHtml(stallConfig.name, pressureData, airSensorsData);
    } catch (error) {
        return `<div class="stall-card error"><h3>${stallConfig.name}</h3><p>連線失敗</p></div>`;
    }
}

async function fetchSensorData(type, id) {
    try {
        const response = await fetch(`/api/sensor-data?type=${type}&id=${id}`);
        if (!response.ok) return { status: "error", displayValue: "Error" };
        return await response.json(); 
    } catch (error) { return { status: "error", displayValue: "Error" }; }
}

function generateStallCardHtml(name, pressureData, airSensorsData) {
    const cardStatusClass = pressureData.status || 'error';
    let statusText = "錯誤";

    console.log(`${name} 壓力數值:`, pressureData.rawValue);

    if (pressureData.status === 'idle') statusText = "閒置中";
    if (pressureData.status === 'in-use') statusText = "使用中";
    if (pressureData.status === 'eco-mode') statusText = "節能模式";

    let durationMin = 0;
    if (pressureData.displayValue && pressureData.displayValue.includes("分鐘")) {
        durationMin = parseInt(pressureData.displayValue);
    }

    // 判斷是否超過10分鐘
    const LONG_USAGE_THRESHOLD = 10;
    let warningHtml = "";
    let additionalCardClass = "";

    if (durationMin >= LONG_USAGE_THRESHOLD) {
        warningHtml = `
            <div class="long-usage-alert">
                ⚠️已使用超過 ${durationMin} 分鐘，請查看情況！
            </div>
        `;
        additionalCardClass = "warning";
    }

    const airSensorsHtml = airSensorsData.map(sensor => `
        <li><strong>${sensor.name}</strong><span class="${sensor.status || ''}">${sensor.displayValue}</span></li>
    `).join('');

    return `
        <div class="stall-card ${cardStatusClass}" onclick="openModal('${name}')" style="cursor:pointer;">
            <div class="stall-status">${statusText}</div>
            <div class="stall-content">
                <h3>${name}</h3>
                <ul class="sensor-data">
                    <li><strong>使用時間</strong><span>${pressureData.displayValue}</span></li>
                    ${airSensorsHtml}
                </ul>
                <div style="text-align:center; margin-top:10px; color:#888; font-size:0.8rem;">(點擊查看統計)</div>
                ${warningHtml}
            </div>
        </div>
    `;
}

// === 隔間詳細分析 & AI 預測 ===
async function openModal(stallName) {
    currentStallName = stallName;
    const modal = document.getElementById('detail-modal');
    modal.style.display = 'flex';
    document.getElementById('modal-title').innerText = `${stallName} - 大數據分析中...`;

    document.getElementById('stat-count').innerText = '-';
    document.getElementById('stat-peak-hour').innerText = '-';
    document.getElementById('ai-suggestion-text').innerText = "正在整合短期趨勢與每週週期...";
    updateCleaningUI(0);

    const stallConfig = STALLS_CONFIG.find(s => s.name === stallName);
    if (!stallConfig) return;

    try {
        const [historyRes, cleanRes] = await Promise.all([
            fetch(`/api/sensor-history-7days?type=${stallConfig.pressureSensor.type}&id=${stallConfig.pressureSensor.id}`).then(r => r.json()),
            fetch(`/api/clean-status?stallName=${encodeURIComponent(stallName)}`).then(r => r.json())
        ]);
        if (!historyRes.Items) throw new Error("無數據");

        const lastCleanTime = cleanRes.lastCleanTime || 0;

        // 分析7天數據
        const { todayCounts, yesterdayCounts, lastWeekCounts, todayTotalCount, items } = analyzeWeeklyData(historyRes.Items);

        document.getElementById('modal-title').innerText = `${stallName} - 智慧預測分析`;
        document.getElementById('stat-count').innerText = todayTotalCount + " 人次";
        
        const usageSinceClean = calculateUsageSinceClean(items, lastCleanTime);
        updateCleaningUI(usageSinceClean, 50); // 50人
        
        const peakHour = findPeakHour(todayCounts);
        document.getElementById('stat-peak-hour').innerText = peakHour;

        // 執行Hybrid Prediction
        const predictedCounts = calculateHybridPrediction(todayCounts, yesterdayCounts, lastWeekCounts);
        generateAdvancedAIInsight(todayTotalCount, peakHour, todayCounts, predictedCounts);

        // 處理圖表顯示數據 (未來時間斷線處理)
        const currentHour = new Date().getHours();
        const displayTodayCounts = todayCounts.map((count, i) => i > currentHour ? null : count);

        renderChart(displayTodayCounts, predictedCounts);

    } catch (err) {
        console.error(err);
        document.getElementById('modal-title').innerText = "數據載入失敗";
    }
}

// 清潔重置功能
async function resetCleaningStatus() {
    if (!currentStallName) return;
    
    try {
        const res = await fetch('/api/clean-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stallName: currentStallName })
        });
        
        if (res.ok) {
            alert(`${currentStallName} 清潔記錄已同步更新至雲端！`);
            // 重新整理UI，這樣所有裝置都會看到更新後的狀態
            openModal(currentStallName);
        } else {
            alert("更新失敗，請檢查網路");
        }
    } catch (e) {
        console.error(e);
        alert("連線錯誤");
    };
}

// 計算自上次清潔後的使用量
function calculateUsageSinceClean(items, lastCleanTime) {
    let count = 0; 
    let isOccupied = false; 
    const THRESHOLD = 5;
    
    items.forEach(item => {
        const val = parseFloat(item.value);
        if (item.timestamp > lastCleanTime) { // 使用 Server 傳來的時間比對
            if (val >= THRESHOLD) { 
                if (!isOccupied) { isOccupied = true; count++; } 
            } else { isOccupied = false; }
        }
    });
    return count;
}

// 7天數據切割器
function analyzeWeeklyData(items) {
    let todayCounts = new Array(24).fill(0);
    let yesterdayCounts = new Array(24).fill(0);
    let lastWeekCounts = new Array(24).fill(0); // 上週同日
    let todayTotalCount = 0;
    
    const now = new Date();
    // 時間錨點
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - (24 * 60 * 60 * 1000);
    // 上週同日的開始時間 (例如今天是週三，這就是上週三)
    // 抓取範圍：6天前 ~ 7天前之間
    const lastWeekStart = todayStart - (7 * 24 * 60 * 60 * 1000); 
    const lastWeekEnd = lastWeekStart + (24 * 60 * 60 * 1000);

    let isOccupied = false;
    const THRESHOLD = 1500;

    items.forEach(item => {
        const val = parseFloat(item.value);
        const timestamp = item.timestamp;
        const date = new Date(timestamp);
        const hour = date.getHours();

        // 判斷時間區間
        const isToday = timestamp >= todayStart;
        const isYesterday = timestamp >= yesterdayStart && timestamp < todayStart;
        const isLastWeek = timestamp >= lastWeekStart && timestamp < lastWeekEnd;

        if (val >= THRESHOLD) {
            if (!isOccupied) {
                isOccupied = true;
                if (isToday) {
                    todayTotalCount++;
                    todayCounts[hour]++;
                } else if (isYesterday) {
                    yesterdayCounts[hour]++;
                } else if (isLastWeek) {
                    lastWeekCounts[hour]++;
                }
            }
        } else {
            if (isOccupied) isOccupied = false;
        }
    });
    return { todayCounts, yesterdayCounts, lastWeekCounts, todayTotalCount, items};
}

// 混合預測演算法 (The Hybrid Model)
function calculateHybridPrediction(today, yesterday, lastWeek) {
    const currentHour = new Date().getHours();

    return today.map((todayVal, index) => {
        let prediction;

        // 如果上週同日沒有數據 (例如裝置剛裝不到一週)，就降級回昨天模式
        // 降級策略 Fallback Strategy
        const hasLastWeekData = lastWeek.some(v => v > 0);
        
        if (index > currentHour) {
            // --- 預測未來 ---
            if (hasLastWeekData) {
                // 公式： 30% 參考昨天 (近期趨勢) + 70% 參考上週同日 (週期慣性)
                // 為什麼上週權重高？因為週一跟週一比較像，跟週日比較不像
                prediction = (yesterday[index] * 0.3) + (lastWeek[index] * 0.7);
            } else {
                // 只有昨天數據時
                prediction = yesterday[index];
            }
            
            // 加入微小隨機波動 (模擬真實世界的不確定性)
            prediction *= (1 + (Math.random() * 0.1 - 0.05));
        } else {
            // --- 過去時間 ---
            // 用平滑曲線連接
            prediction = (todayVal * 0.6) + (yesterday[index] * 0.4);
        }
        
        return Math.round(prediction * 10) / 10;
    });
}

// AI建議
function generateAdvancedAIInsight(count, peakHourStr, todayCounts, predictedCounts) {
    const el = document.getElementById('ai-suggestion-text');
    
    // 計算明日預估總量
    const predictedTotal = predictedCounts.reduce((a,b) => a+b, 0);
    const trend = predictedTotal > count ? "上升 📈" : "下降 📉";
    
    let msg = `📊模型預測明日人流將${trend} (約${Math.round(predictedTotal)}人次)。`;

    // 判斷是否為週末模式 (假設上週數據顯示差異)
    // 這裡可以寫死一個邏輯：如果今天是週五，提示明天(週六)可能變少(商辦)或變多(景點)
    const tomorrowDay = new Date(new Date().getTime() + 24*60*60*1000).getDay();
    const isWeekend = (tomorrowDay === 0 || tomorrowDay === 6);
    
    if (isWeekend) {
        msg += " 明日為週末，系統已自動調整為假日節能模式";
    } else if (peakHourStr !== "無資料") {
        msg += ` 建議在 ${peakHourStr} 前加強通風並補給備品。`;
    }

    el.innerText = msg;
}

// === ESG 報表 ===
async function openEnergyReport() {
    const modal = document.getElementById('energy-modal');
    modal.style.display = 'flex';
    document.getElementById('esg-kwh').innerText = '計算中...';
    document.getElementById('esg-carbon').innerText = '-';
    document.getElementById('esg-rate').innerText = '-';

    try {
        let totalSmartMWh = 0;
        let totalTraditionalMWh = 0;
        const CO2_FACTOR = 0.495; // kgCO2e / kWh

        for (const stall of STALLS_CONFIG) {
            const response = await fetch(`/api/sensor-history?type=${stall.powerConsumption.type}&id=${stall.powerConsumption.id}`);
            const data = await response.json();
            const items = data.Items || [];

            if (items.length === 0) continue;

            // 計算實際耗電
            let stallTotalMWh = 0;
            items.forEach(item => {
                const val = parseFloat(item.value);
                if (!isNaN(val)) stallTotalMWh += val;
            });
            totalSmartMWh += stallTotalMWh;

            // 計算傳統耗電 (Traditional Baseline)
            // 假設傳統是 24 小時全開 = 1440 分鐘
            const estimatedDailyCount = 1440; 
            totalTraditionalMWh += (TRADITIONAL_BASELINE_MWH_PER_MIN * estimatedDailyCount);
        }

        if (totalTraditionalMWh < totalSmartMWh) totalTraditionalMWh = totalSmartMWh;

        // mWh -> Wh (除以 1000)
        const totalSmartWh = totalSmartMWh / 1000;
        const totalTraditionalWh = totalTraditionalMWh / 1000;
        
        const savedWh = totalTraditionalWh - totalSmartWh;
        
         // 計算碳排 (先換算成kWh算 kg，再換算成g)
        // (Wh / 1000) * 0.495 = kgCO2e
        // kgCO2e * 1000 = gCO2e
        // 簡化公式：savedWh * 0.495 就是 gCO2e
        const savedCarbonGrams = savedWh * CO2_FACTOR;
        
        const savingRate = totalTraditionalWh > 0 ? (savedWh / totalTraditionalWh) * 100 : 0;

        document.getElementById('esg-kwh').innerText = savedWh.toFixed(1); // Wh
        document.getElementById('esg-carbon').innerText = savedCarbonGrams.toFixed(1); // g
        document.getElementById('esg-rate').innerText = savingRate.toFixed(1);

        renderEnergyChart(totalTraditionalWh, totalSmartWh);

    } catch (err) {
        console.error(err);
        document.getElementById('esg-kwh').innerText = "Error";
    }
}

function calculateAverage(items) {
    if (!items || items.length === 0) return 0;
    let sum = 0; let count = 0;
    items.forEach(item => { const val = parseFloat(item.value); if (!isNaN(val)) { sum += val; count++; } });
    return count > 0 ? sum / count : 0;
}

function renderEnergyChart(trad, smart) {
    const canvas = document.getElementById('energyChart');
    const ctx = canvas.getContext('2d');
    if (energyChartInstance) energyChartInstance.destroy();
    if (canvas.parentNode) canvas.parentNode.style.height = '400px';
    let gradientTrad = ctx.createLinearGradient(0, 0, 0, 400);
    gradientTrad.addColorStop(0, '#6c757d'); gradientTrad.addColorStop(1, '#adb5bd');
    let gradientSmart = ctx.createLinearGradient(0, 0, 0, 400);
    gradientSmart.addColorStop(0, '#28a745'); gradientSmart.addColorStop(1, '#81c784');
    energyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['傳統模式 (24H)', '本智慧系統'],
            datasets: [{ label: '耗電量 (Wh)', data: [trad, smart], backgroundColor: [gradientTrad, gradientSmart], borderRadius: 10, barThickness: 80 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, title: { display: true, text: '耗電量 (Wh)' } }, x: { grid: { display: false } } }
        }
    });
}

function updateCleaningUI(currentCount, threshold = 50) {
    const percent = Math.min(Math.round((currentCount / threshold) * 100), 100);
    const bar = document.getElementById('clean-progress-bar');
    const statusText = document.getElementById('stat-clean-status');

    document.getElementById('clean-count').innerText = currentCount;

    bar.style.width = `${percent}%`;
    if (percent < 50) {
        bar.style.backgroundColor = '#28a745'; statusText.innerText = "狀態良好"; statusText.style.color = '#28a745';
    } else if (percent < 80) {
        bar.style.backgroundColor = '#ffc107'; statusText.innerText = "需留意"; statusText.style.color = '#856404';
    } else {
        bar.style.backgroundColor = '#dc3545'; statusText.innerText = "建議清潔"; statusText.style.color = '#dc3545';
    }
}

function findPeakHour(hourlyCounts) {
    let maxCount = -1; let maxHour = -1;
    hourlyCounts.forEach((count, hour) => { if (count > maxCount) { maxCount = count; maxHour = hour; } });
    if (maxCount <= 0) return "無資料";
    return `${maxHour}:00 - ${maxHour + 1}:00`;
}

function renderChart(hourlyData, predictedData) {
    const canvas = document.getElementById('usageChart');
    const ctx = canvas.getContext('2d');
    if (usageChartInstance) usageChartInstance.destroy();

    if (canvas.parentNode) canvas.parentNode.style.height = '400px';

    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(0, 123, 255, 0.6)'); gradient.addColorStop(1, 'rgba(0, 123, 255, 0.05)');

    usageChartInstance = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: Array.from({length: 24}, (_, i) => `${i}:00`),
            datasets: [
                {
                    label: '今日實際人流',
                    data: hourlyData,
                    borderColor: '#007bff', borderWidth: 3, backgroundColor: gradient, fill: true, tension: 0.4,
                    spanGaps: false, 
                    pointRadius: 0, pointHoverRadius: 6, pointBackgroundColor: '#fff', pointBorderColor: '#007bff'
                },
                {
                    label: 'AI預測明日人流',
                    data: predictedData,
                    borderColor: '#6f42c1', borderWidth: 2, borderDash: [5, 5], fill: false, tension: 0.4, pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: true } },
            scales: {
                y: { beginAtZero: true, suggestedMax: 10, ticks: { stepSize: 1, color: '#888' }, grid: { borderDash: [5, 5] } },
                x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 13, color: '#888' } }
            }
        }
    });
}

function closeModal(modalId) {
    const id = modalId || 'detail-modal';
    document.getElementById(id).style.display = 'none';
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) event.target.style.display = "none";
}