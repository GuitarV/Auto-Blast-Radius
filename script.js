// script.js
class DataService {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.cache = new Map();
        this.cacheDuration = 5 * 60 * 1000; // 5分钟缓存
    }

    async getData(requestData) {
        try {
            const site = requestData.site;
            if (!site) {
                throw new Error('Site parameter is required');
            }

            // 检查缓存
            const cacheKey = `data_${site}`;
            if (this.cache.has(cacheKey)) {
                const { timestamp, value } = this.cache.get(cacheKey);
                if (Date.now() - timestamp < this.cacheDuration) {
                    return this.formatResponse(value);
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

            return this.formatResponse(data);
        } catch (error) {
            console.error('Error:', error);
            return this.formatErrorResponse(error);
        }
    }

    // 格式化成功响应，匹配Lambda的响应格式
    formatResponse(data) {
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify(data)
        };
    }

    // 格式化错误响应，匹配Lambda的错误响应格式
    formatErrorResponse(error) {
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Failed to retrieve data',
                message: error.message
            })
        };
    }
}

// 创建处理函数
async function handleRequest(event) {
    const dataService = new DataService('https://guitarv.github.io/Auto-Blast-Radius');
    
    try {
        // 解析请求体
        const requestData = typeof event.body === 'string' 
            ? JSON.parse(event.body) 
            : event.body;

        // 获取数据
        return await dataService.getData(requestData);
    } catch (error) {
        return {
            statusCode: 400,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Invalid request',
                message: error.message
            })
        };
    }
}

// 处理OPTIONS请求（用于CORS预检）
function handleOptions() {
    return {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        },
        body: ''
    };
}

// 主处理函数
async function main(event) {
    // 处理CORS预检请求
    if (event.httpMethod === 'OPTIONS') {
        return handleOptions();
    }

    // 处理实际请求
    return await handleRequest(event);
}

// 导出处理函数
exports.handler = main;
