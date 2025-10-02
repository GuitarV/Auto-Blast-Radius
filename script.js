class DataService {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.cache = new Map();
        this.cacheDuration = 5 * 60 * 1000; // 5分钟缓存
    }

    async getData(site) {
        try {
            // 构建缓存键
            const cacheKey = `data_${site}`;
            
            // 检查缓存
            if (this.cache.has(cacheKey)) {
                const { timestamp, value } = this.cache.get(cacheKey);
                if (Date.now() - timestamp < this.cacheDuration) {
                    return value;
                }
            }

            // 构建文件URL
            const fileUrl = `${this.baseUrl}/data/${site}.json`;
            
            // 获取数据
            const response = await fetch(fileUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();

            // 更新缓存
            this.cache.set(cacheKey, {
                timestamp: Date.now(),
                value: data
            });

            return data;
        } catch (error) {
            console.error(`Failed to fetch data for site ${site}:`, error);
            throw error;
        }
    }
}

// 初始化服务
const baseUrl = 'https://your-username.github.io/my-json-data';
const dataService = new DataService(baseUrl);

// 获取URL参数中的site值
function getSiteParameter() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('site');
}

// 显示数据
async function displayData() {
    try {
        const site = getSiteParameter();
        if (!site) {
            throw new Error('Site parameter is required');
        }

        const data = await dataService.getData(site);
        const container = document.getElementById('data-container');
        
        // 格式化显示
        container.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    } catch (error) {
        const container = document.getElementById('data-container');
        container.innerHTML = `
            <div style="color: red; padding: 20px; border: 1px solid red; border-radius: 4px;">
                <h3>Error</h3>
                <p>${error.message}</p>
            </div>
        `;
    }
}

// 页面加载时执行
window.onload = displayData;
