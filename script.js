let usageChartInstance = null;
let energyChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    updateDashboard();
    setInterval(updateDashboard, 5000); 
});

const STALLS_CONFIG = [
    {
        name: "隔間 1",
        pressureSensor: { type: "ELECTRIC_CURRENT", id: "1c788f5f-0e3e-4297-84cd-a66b7d3d9562" },
        airSensors: [{ name: "eCO2", type: "AIR_PRESS", id: "1d3a465b-d312-4f12-b24a-d818676bd6ca" }],
        powerConfig: {
            voltage: { type: "BATTERY_VOLTAGE", id: "ec90c93e-c304-436f-aa6c-1f4a9739f78b" }, 
            current: { type: "ELECTRIC_CURRENT", id: "1c788f5f-0e3e-4297-84cd-a66b7d3d9562" }
        }
    },
    {
        name: "隔間 2",
        pressureSensor: { type: "BATTERY_VOLTAGE", id: "ec90c93e-c304-436f-aa6c-1f4a9739f78b" },
        airSensors: [{ name: "eCO2", type: "AIR_PRESS", id: "1d3a465b-d312-4f12-b24a-d818676bd6ca" }],
        powerConfig: {
            voltage: { type: "BATTERY_VOLTAGE", id: "ec90c93e-c304-436f-aa6c-1f4a9739f78b" },
            current: { type: "ELECTRIC_CURRENT", id: "1c788f5f-0e3e-4297-84cd-a66b7d3d9562" }
        }
    }
];

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
    if (pressureData.status === 'idle') statusText = "閒置中";
    if (pressureData.status === 'in-use') statusText = "使用中";
    if (pressureData.status === 'eco-mode') statusText = "節能模式";

    const airSensorsHtml = airSensorsData.map(sensor => `
        <li><strong>${sensor.name}</strong><span class="${sensor.status || ''}">${sensor.displayValue}</span></li>
    `).join('');

    return `
        <div class="stall-card ${cardStatusClass}" onclick="openModal('${name}')" style="cursor:pointer;">
            <div class="stall-status">${statusText}</div>
            <div class="stall-content">
                <h3>${name}</h3>
                <ul class="sensor-data">
                    <li><strong>壓力</strong><span>${pressureData.displayValue}</span></li>
                    ${airSensorsHtml}
                </ul>
                <div style="text-align:center; margin-top:10px; color:#888; font-size:0.8rem;">(點擊查看統計)</div>
            </div>
        </div>
    `;
}

// === 隔間詳細分析 ===
async function openModal(stallName) {
    const modal = document.getElementById('detail-modal');
    modal.style.display = 'flex';
    document.getElementById('modal-title').innerText = `${stallName} - 分析中...`;
    
    document.getElementById('stat-count').innerText = '-';
    document.getElementById('stat-peak-hour').innerText = '-';
    updateCleaningUI(0);

    const stallConfig = STALLS_CONFIG.find(s => s.name === stallName);
    if (!stallConfig) return;

    try {
        const res = await fetch(`/api/sensor-history?type=${stallConfig.pressureSensor.type}&id=${stallConfig.pressureSensor.id}`);
        const data = await res.json();
        if (!data.Items) throw new Error("無數據");

        const analysis = analyzeUsage(data.Items);

        document.getElementById('modal-title').innerText = `${stallName} - 智慧分析`;
        document.getElementById('stat-count').innerText = analysis.totalCount + " 人次";

        // 更新清潔進度 UI
        // 假設閾值：每50人次需要清潔一次
        const CLEANING_THRESHOLD = 50; 
        updateCleaningUI(analysis.totalCount, CLEANING_THRESHOLD);

        // 更新尖峰時段 UI
        const peakHour = findPeakHour(analysis.hourlyCounts);
        document.getElementById('stat-peak-hour').innerText = peakHour;

        renderChart(analysis.hourlyCounts);
    } catch (err) {
        console.error(err);
        document.getElementById('modal-title').innerText = "數據載入失敗";
    }
}

// 輔助：更新清潔進度條
function updateCleaningUI(currentCount, threshold = 50) {
    const percent = Math.min(Math.round((currentCount / threshold) * 100), 100);
    const bar = document.getElementById('clean-progress-bar');
    const statusText = document.getElementById('stat-clean-status');
    const percentText = document.getElementById('clean-percent');

    bar.style.width = `${percent}%`;
    percentText.innerText = percent;

    if (percent < 50) {
        bar.style.backgroundColor = '#28a745'; // 綠色 (良好)
        statusText.innerText = "狀態良好";
        statusText.style.color = '#28a745';
    } else if (percent < 80) {
        bar.style.backgroundColor = '#ffc107'; // 黃色 (注意)
        statusText.innerText = "需留意";
        statusText.style.color = '#856404';
    } else {
        bar.style.backgroundColor = '#dc3545'; // 紅色 (警告)
        statusText.innerText = "建議清潔";
        statusText.style.color = '#dc3545';
    }
}

// 輔助：找出尖峰時段 (ex: "14:00 - 15:00")
function findPeakHour(hourlyCounts) {
    let maxCount = -1;
    let maxHour = -1;
    hourlyCounts.forEach((count, hour) => {
        if (count > maxCount) {
            maxCount = count;
            maxHour = hour;
        }
    });

    if (maxCount <= 0) return "無資料";
    return `${maxHour}:00 - ${maxHour + 1}:00`;
}

// === ESG 報表 ===
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
            const [voltageRes, currentRes] = await Promise.all([
                fetch(`/api/sensor-history?type=${stall.powerConfig.voltage.type}&id=${stall.powerConfig.voltage.id}`).then(r => r.json()),
                fetch(`/api/sensor-history?type=${stall.powerConfig.current.type}&id=${stall.powerConfig.current.id}`).then(r => r.json())
            ]);

            const avgVolts = calculateAverage(voltageRes.Items);
            const currentItems = currentRes.Items || [];
            if (currentItems.length === 0) continue;

            const avgActualAmps = calculateAverage(currentItems);
            const sortedCurrents = currentItems.map(i => parseFloat(i.value)).sort((a, b) => b - a);
            const topCount = Math.ceil(sortedCurrents.length * 0.2); 
            const topCurrents = sortedCurrents.slice(0, topCount);
            const activeStateAmps = topCurrents.reduce((a, b) => a + b, 0) / topCount;

            const actualPowerKw = (avgVolts * avgActualAmps) / 1000;
            const traditionalPowerKw = (avgVolts * activeStateAmps) / 1000;

            totalTraditionalKwh += (traditionalPowerKw * 24);
            totalSmartKwh += (actualPowerKw * 24);
        }

        if (totalTraditionalKwh < totalSmartKwh) totalTraditionalKwh = totalSmartKwh;
        const savedKwh = totalTraditionalKwh - totalSmartKwh;
        const savedCarbon = savedKwh * CO2_FACTOR;
        const savingRate = totalTraditionalKwh > 0 ? (savedKwh / totalTraditionalKwh) * 100 : 0;

        document.getElementById('esg-kwh').innerText = savedKwh.toFixed(3);
        document.getElementById('esg-carbon').innerText = savedCarbon.toFixed(3);
        document.getElementById('esg-rate').innerText = savingRate.toFixed(1);
        renderEnergyChart(totalTraditionalKwh, totalSmartKwh);

    } catch (err) {
        console.error(err);
        document.getElementById('esg-kwh').innerText = "Error";
    }
}

function calculateAverage(items) {
    if (!items || items.length === 0) return 0;
    let sum = 0; let count = 0;
    items.forEach(item => {
        const val = parseFloat(item.value);
        if (!isNaN(val)) { sum += val; count++; }
    });
    return count > 0 ? sum / count : 0;
}

function renderEnergyChart(trad, smart) {
    const canvas = document.getElementById('energyChart');
    const ctx = canvas.getContext('2d');
    if (energyChartInstance) energyChartInstance.destroy();

    let gradientTrad = ctx.createLinearGradient(0, 0, 0, 350);
    gradientTrad.addColorStop(0, '#6c757d'); gradientTrad.addColorStop(1, '#adb5bd');
    let gradientSmart = ctx.createLinearGradient(0, 0, 0, 350);
    gradientSmart.addColorStop(0, '#28a745'); gradientSmart.addColorStop(1, '#81c784');

    energyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['傳統模式 (24H)', '本智慧系統'],
            datasets: [{ label: '耗電量 (kWh)', data: [trad, smart], backgroundColor: [gradientTrad, gradientSmart], borderRadius: 10, barThickness: 80 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, title: { display: true, text: '耗電量 (kWh)' } }, x: { grid: { display: false } } }
        }
    });
}

function analyzeUsage(items) {
    let usageCount = 0; let totalDurationSec = 0; let hourlyCounts = new Array(24).fill(0); 
    let isOccupied = false; let startTime = 0; const THRESHOLD = 5; 
    items.forEach(item => {
        const val = parseFloat(item.value);
        const time = new Date(item.timestamp); 
        const hour = time.getHours();
        if (val >= THRESHOLD) {
            if (!isOccupied) { isOccupied = true; startTime = time.getTime(); usageCount++; hourlyCounts[hour]++; }
        } else {
            if (isOccupied) {
                isOccupied = false;
                const duration = (time.getTime() - startTime) / 1000; 
                if (duration > 10) totalDurationSec += duration;
                else { usageCount--; hourlyCounts[hour]--; }
            }
        }
    });
    const avgDuration = usageCount > 0 ? (totalDurationSec / 60) / usageCount : 0; 
    return { totalCount: usageCount, avgDuration: avgDuration, hourlyCounts: hourlyCounts };
}

function renderChart(hourlyData) {
    const canvas = document.getElementById('usageChart');
    const ctx = canvas.getContext('2d');
    if (usageChartInstance) usageChartInstance.destroy();

    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(0, 123, 255, 0.6)'); gradient.addColorStop(1, 'rgba(0, 123, 255, 0.05)');

    usageChartInstance = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: Array.from({length: 24}, (_, i) => `${i}:00`),
            datasets: [{
                label: '使用人次', data: hourlyData, borderColor: '#007bff', borderWidth: 3, backgroundColor: gradient, fill: true, tension: 0.4,
                pointRadius: 0, pointHoverRadius: 6, pointBackgroundColor: '#fff', pointBorderColor: '#007bff'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1, color: '#888' }, grid: { borderDash: [5, 5] } },
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