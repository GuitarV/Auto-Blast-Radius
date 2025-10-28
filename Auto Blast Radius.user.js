// ==UserScript==
// @name         Auto Blast Radius
// @namespace    http://tampermonkey.net/
// @version      1.2
// @author       xiongwev
// @description  Display datacenter rack topology
// @match        https://w.amazon.com/bin/view/G_China_Infra_Ops/BJSPEK/DCEO/Auto_Blast_Radius*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/select2/4.1.0-rc.0/js/select2.min.js
// @resource     SELECT2_CSS https://cdnjs.cloudflare.com/ajax/libs/select2/4.1.0-rc.0/css/select2.min.css
// @connect      twuukpz75g.execute-api.us-west-2.amazonaws.com
// @connect      cloudforge-build.amazon.com
// @connect      aha.bjs.aws-border.cn
// @connect      cdnjs.cloudflare.com
// @connect      cdn.jsdelivr.net
// @connect      code.jquery.com
// @connect      ajax.googleapis.com
// @connect      midway-auth.aws-border.cn
// @connect      sentry.amazon.com
// @connect      sso.amazon.com
// @connect      idp.amazon.com
// @connect      *.aws-border.cn
// @connect      *.amazon.com
// @updateURL    https://github.com/GuitarV/Auto-Blast-Radius/raw/refs/heads/main/Auto%20Blast%20Radius.user.js
// @downloadURL  https://github.com/GuitarV/Auto-Blast-Radius/raw/refs/heads/main/Auto%20Blast%20Radius.user.js

// ==/UserScript==

(function() {
    'use strict';

    const loadExternalResources = async () => {
        // 先加载 jQuery
        if (typeof jQuery === 'undefined') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        // 然后加载 select2 JS
        if (typeof jQuery.fn.select2 === 'undefined') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/select2/4.1.0-rc.0/js/select2.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        // 最后加载 select2 CSS
        if (!document.querySelector('link[href*="select2"]')) {
            await new Promise((resolve, reject) => {
                const style = document.createElement('link');
                style.rel = 'stylesheet';
                style.href = 'https://cdnjs.cloudflare.com/ajax/libs/select2/4.1.0-rc.0/css/select2.min.css';
                style.onload = resolve;
                style.onerror = reject;
                document.head.appendChild(style);
            });
        }
    };


    let EXCEL_DATA = [];
    let positionMap = new Map();
    const LAMBDA_URL = 'https://twuukpz75g.execute-api.us-west-2.amazonaws.com/default/GetS3Data';

    // 可选的站点列表
    const AVAILABLE_SITES = [
        'BJS9',
        'BJS10',
        'BJS11',
        'BJS12',
        'BJS20',
        'BJS50',
        'BJS51',
        'BJS52',
        'BJS60',
        'BJS70',
        'BJS71',
        'BJS73',
        'BJS74',
        'BJS80',
        'PEK7',
        'PEK50',
        'PKX140',
        // ... 添加更多站点
    ];

    // 新的设置界面函数
    function setupInterface() {
        const xwikiContent = document.getElementById('xwikicontent');
        if (!xwikiContent) {
            throw new Error('Target container #xwikicontent not found');
        }

        // 创建数据显示容器
        const container = document.createElement('div');
        container.className = 'topo-container';

        // 创建自定义下拉菜单
        const siteSection = document.createElement('div');
        siteSection.className = 'site-selection-section';
        siteSection.innerHTML = `
    <h2>Select Data Center Site</h2>
    <div class="custom-dropdown">
        <div class="selected-option" tabindex="0">Select a Site</div>
        <ul class="dropdown-options">
            ${AVAILABLE_SITES.map(site => `<li data-value="${site}">${site}</li>`).join('')}
        </ul>
    </div>
`;
        container.appendChild(siteSection);

        // 添加模态框结构
        const modalHtml = `
        <div class="modal-backdrop"></div>
        <div class="position-modal">
            <div class="modal-header">
                <div class="modal-title"></div>
                <div class="modal-close">&times;</div>
            </div>
            <div class="modal-content">
                <div class="position-list"></div>
            </div>
        </div>
    `;

        // 创建模态框容器并添加到 container
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = modalHtml;
        container.appendChild(modalContainer);

        // 添加加载指示器
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'loading-indicator';
        loadingIndicator.style.display = 'none';
        container.appendChild(loadingIndicator);

        // 添加筛选器容器
        const filtersContainer = document.createElement('div');
        filtersContainer.className = 'filters-container';
        filtersContainer.style.display = 'none';
        container.appendChild(filtersContainer);

        // 添加进度条容器
        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';
        progressContainer.innerHTML = `
    <div class="progress-bar">
        <div class="progress-fill"></div>
    </div>
    <div class="progress-text">Loading: <span class="progress-percentage">0%</span></div>
    <div class="progress-step">Initializing...</div>
`;
        progressContainer.style.display = 'none';
        container.appendChild(progressContainer);

        // 添加视图容器
        const topoView = document.createElement('div');
        topoView.className = 'topo-view';
        topoView.style.display = 'none';
        container.appendChild(topoView);
        xwikiContent.appendChild(container);

        // 获取所有需要的 DOM 元素引用
        const dropdown = container.querySelector('.custom-dropdown');
        const selectedOption = dropdown.querySelector('.selected-option');
        const optionsList = dropdown.querySelector('.dropdown-options');

        // 下拉菜单逻辑
        selectedOption.addEventListener('click', () => {
            optionsList.style.display = optionsList.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', (event) => {
            if (!dropdown.contains(event.target)) {
                optionsList.style.display = 'none';
            }
        });

        // AHA 登录检查函数
        function checkAHALogin() {
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: 'https://aha.bjs.aws-border.cn/health',
                    headers: {
                        "Accept": "application/json",
                    },
                    timeout: 10000,
                    withCredentials: true,
                    onload: function(response) {
                        // 如果需要登录
                        if (response.finalUrl && response.finalUrl.includes('midway-auth.aws-border.cn')) {
                            console.log('AHA login required');
                            // 打开登录页面，但不等待
                            window.open('https://midway-auth.aws-border.cn/login', '_blank');
                        }
                        resolve();
                    },
                    onerror: function(error) {
                        console.warn('AHA login check failed:', error);
                        resolve();
                    },
                    ontimeout: function() {
                        console.warn('AHA login check timeout');
                        resolve();
                    }
                });
            });
        }


        // 选项点击处理
        optionsList.addEventListener('click', async (event) => {
            if (event.target.tagName === 'LI') {
                const selectedSite = event.target.getAttribute('data-value');
                selectedOption.textContent = selectedSite;
                optionsList.style.display = 'none';

                try {
                    const progressContainer = container.querySelector('.progress-container');
                    const progressFill = progressContainer.querySelector('.progress-fill');
                    const progressText = progressContainer.querySelector('.progress-percentage');
                    const progressStep = progressContainer.querySelector('.progress-step');

                    loadingIndicator.style.display = 'none';
                    progressContainer.style.display = 'block';
                    filtersContainer.style.display = 'none';
                    topoView.style.display = 'none';

                    // 更新进度函数
                    const updateProgress = (percentage, step) => {
                        progressFill.style.width = `${percentage}%`;
                        progressText.textContent = `${percentage}%`;
                        progressStep.textContent = step;
                    };

                    // 检查 AHA 登录状态
                    updateProgress(5, 'Checking AHA login status...');
                    await checkAHALogin();

                    // 加载主数据
                    updateProgress(10, 'Loading site topology data😀...');
                    const data = await loadDataFromLambda(selectedSite);
                    if (!data || !Array.isArray(data)) {
                        throw new Error('Invalid data format received');
                    }

                    updateProgress(30, 'Processing data🤣...');
                    EXCEL_DATA = data;

                    updateProgress(50, 'Getting position site...');
                    const site = getPositionSite(EXCEL_DATA);

                    updateProgress(70, 'Fetching position info🤔...');
                    positionMap = await fetchPositionInfo(site);

                    updateProgress(90, 'Preparing display...');
                    const currentTopoView = container.querySelector('.topo-view');
                    const currentFiltersContainer = container.querySelector('.filters-container');

                    if (currentTopoView && currentFiltersContainer) {
                        updateProgress(95, 'Initializing filters...');
                        window.filtersInitialized = false;

                        updateProgress(100, 'Completing😎...');
                        setTimeout(() => {
                            progressContainer.style.display = 'none';
                            currentFiltersContainer.style.display = 'grid';
                            currentTopoView.style.display = 'block';
                            updateDisplay({});
                        }, 100);
                    } else {
                        throw new Error('Required display elements not found');
                    }

                } catch (error) {
                    console.error('Error loading site data:', error);
                    const progressContainer = container.querySelector('.progress-container');
                    if (progressContainer) {
                        progressContainer.style.display = 'none';
                    }
                    loadingIndicator.style.display = 'block';
                    loadingIndicator.style.color = 'red';
                    loadingIndicator.textContent = `Error: ${error.message}`;

                    EXCEL_DATA = [];
                    positionMap.clear();

                    if (filtersContainer) filtersContainer.style.display = 'none';
                    if (topoView) topoView.style.display = 'none';
                }
            }
        });
        return container;
    }

    // 创建 UPS 路由信息映射
    function createUPSRoutingMap(secondaryData) {
        const routingMap = {
            usbMap: new Map(),
            upsGroupMap: new Map()
        };

        secondaryData.forEach(item => {
            const routingInfo = {
                transformer: item.Transformer,
                utility: item.Utility
            };

            // 分别用 USB 和 UPS Group 建立映射
            if (item.USB) {
                routingMap.usbMap.set(item.USB, routingInfo);
            }
            if (item['UPS Group']) {
                routingMap.upsGroupMap.set(item['UPS Group'], routingInfo);
            }
        });

        return routingMap;
    }

    // 从 Lambda 加载数据
    async function loadDataFromLambda(site) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: LAMBDA_URL,
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYmpzZGNlbyIsInR5cGUiOiJwZXJtYW5lbnQifQ.mKaIWhj_d7kxB8fwh2BDDGKMyVLrkiwZZzuZzc8ra6s",
                },
                data: JSON.stringify({ site: site }),
                onload: function(response) {
                    try {
                        if (response.status === 200) {
                            const responseData = JSON.parse(response.responseText);
                            const primaryData = responseData.body ?
                                  JSON.parse(responseData.body).primary_data :
                            responseData.primary_data;
                            const secondaryData = responseData.body ?
                                  JSON.parse(responseData.body).secondary_data :
                            responseData.secondary_data;
                            if (!primaryData || (Array.isArray(primaryData) && primaryData.length === 0)) {
                                reject(new Error(`No primary data available for site ${site}`));
                                return;
                            }
                            const routingMap = createUPSRoutingMap(secondaryData);
                            const enrichedData = primaryData.map(item => {
                                // 确保所有必需字段都有默认值
                                const cleanedItem = {
                                    'Position Site': item['Position Site'] || 'Unknown',
                                    'Position Room': item['Position Room'] || 'Unknown',
                                    'Position': item['Position'] || 'Unknown',
                                    'Circuit Name': item['Circuit Name'] || 'Unknown',
                                    'Circuit Number': item['Circuit Number'] || 'Unknown',
                                    'PDU Name': item['PDU Name'] || 'Unknown',
                                    'PDU Type': item['PDU Type'] || 'Unknown',
                                    'UPS Group': item['UPS Group'] || 'Unknown',
                                    'USB': item['USB'] || 'Unknown',
                                    'Power Feed': item['Power Feed'] || 'Unknown',
                                    ...item
                                };

                                // 尝试通过 USB 匹配
                                let routingInfo = cleanedItem.USB ? routingMap.usbMap.get(cleanedItem.USB) : null;

                                // 尝试通过 UPS Group 匹配
                                if (!routingInfo && cleanedItem['UPS Group']) {
                                    routingInfo = routingMap.upsGroupMap.get(cleanedItem['UPS Group']);
                                }

                                // 如果都没找到，使用默认值
                                if (!routingInfo) {
                                    routingInfo = {
                                        transformer: 'Unknown',
                                        utility: 'Unknown'
                                    };
                                }

                                return {
                                    ...cleanedItem,
                                    routingInfo: routingInfo
                                };
                            });
                            resolve(enrichedData);
                        } else {
                            const errorMessage = response.responseText ?
                                  `Error: ${JSON.parse(response.responseText).message || response.statusText}` :
                            `Failed to load data for ${site}`;
                            reject(new Error(errorMessage));
                        }
                    } catch (error) {
                        console.error(`Error parsing response for ${site}:`, error);
                        reject(new Error(`Unable to process data for ${site}. Please try again later.`));
                    }
                },
                onerror: (error) => {
                    console.error(`Network error for ${site}:`, error);
                    reject(new Error(`Network error: Unable to connect to the server. Please check your connection and try again.`));
                },
                ontimeout: () => {
                    console.error(`Request timeout for ${site}`);
                    reject(new Error(`Request timed out. Please try again later.`));
                }
            });
        });
    }

    function getFilterOptions() {
        if (!EXCEL_DATA || !Array.isArray(EXCEL_DATA)) {
            console.error('Invalid data format');
            return [];
        }

        return [
            { label: 'Data Hall', column: 'Position Room' },
            {
                label: 'Rack',
                column: 'Position',
                isPosition: true
            },
            { label: 'PDU Name', column: 'PDU Name' },
            { label: 'UPS Group', column: 'UPS Group' },
            { label: 'USB', column: 'USB' },
            { label: 'Transformer', column: 'routingInfo.transformer' },
            { label: 'Utility', column: 'routingInfo.utility' },
            { label: 'Power Feed', column: 'Power Feed' },
            { label: 'Rack Status', column: 'status' },
            { label: 'Rack Type', column: 'type' }
        ];
    }


    // 辅助函数：发送请求
    function makeRequest(url, method, retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 200;
        console.log(`Making request to ${url} (attempt ${retryCount + 1}/${maxRetries + 1})`);
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: method,
                url: url,
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout: 30000,
                withCredentials: true,
                onload: function(response) {
                    console.log(`Response from ${url}:`, {
                        status: response.status,
                        statusText: response.statusText,
                        finalUrl: response.finalUrl,
                        responseText: response.responseText ?
                            (response.responseText.substring(0, 200) + '...') :
                            'No response text'
                    });

                    if (response.status === 200) {
                        resolve(response);
                    } else if (response.status === 401 || response.status === 403 ||
                               response.responseText.includes('login') ||
                               response.finalUrl?.includes('midway-auth') ||
                               response.finalUrl?.includes('sentry.amazon.com')) {

                        console.log('Authentication required for:', url);

                        // 根据 URL 决定打开哪个登录页面
                        let loginUrl = 'https://cloudforge-build.amazon.com/';
                        if (url.includes('aha.bjs.aws-border.cn')) {
                            loginUrl = 'https://midway-auth.aws-border.cn/login';
                        }

                        console.log('Opening login page:', loginUrl);
                        window.open(loginUrl, '_blank');

                        // 如果还有重试次数，等待后重试
                        if (retryCount < maxRetries) {
                            console.log(`Will retry ${url} in ${retryDelay * (retryCount + 1)}ms`);
                            setTimeout(() => {
                                makeRequest(url, method, retryCount + 1)
                                    .then(resolve)
                                    .catch(reject);
                            }, retryDelay * (retryCount + 1));
                        } else {
                            console.error('Max retries reached for authentication');
                            reject(new Error('Authentication required. Please login and try again.'));
                        }
                    } else {
                        // 如果是其他错误且还有重试次数
                        if (retryCount < maxRetries) {
                            console.log(`Request failed, will retry ${url} in ${retryDelay * (retryCount + 1)}ms`);
                            setTimeout(() => {
                                makeRequest(url, method, retryCount + 1)
                                    .then(resolve)
                                    .catch(reject);
                            }, retryDelay * (retryCount + 1));
                        } else {
                            console.error('Max retries reached for request');
                            reject(new Error(`Request failed with status ${response.status}`));
                        }
                    }
                },
                onerror: function(error) {
                    console.error(`Error for ${url}:`, error);
                    if (retryCount < maxRetries) {
                        console.log(`Network error, will retry ${url} in ${retryDelay * (retryCount + 1)}ms`);
                        setTimeout(() => {
                            makeRequest(url, method, retryCount + 1)
                                .then(resolve)
                                .catch(reject);
                        }, retryDelay * (retryCount + 1));
                    } else {
                        console.error('Max retries reached after network error');
                        reject(error);
                    }
                },
                ontimeout: function() {
                    console.error(`Timeout for ${url}`);
                    if (retryCount < maxRetries) {
                        console.log(`Request timed out, will retry ${url} in ${retryDelay * (retryCount + 1)}ms`);
                        setTimeout(() => {
                            makeRequest(url, method, retryCount + 1)
                                .then(resolve)
                                .catch(reject);
                        }, retryDelay * (retryCount + 1));
                    } else {
                        console.error('Max retries reached after timeout');
                        reject(new Error('Request timed out'));
                    }
                }
            });
        });
    }

    // 定义类型映射表
    const RACK_TYPE_MAPPING = {
        // Network 类型
        'NETWORK': 'Network',
        'Security': 'Network',
        'Fusion Even Prim': 'Network',
        'Fusion Odd Prim': 'Network',
        'Network Core - W': 'Network',
        'Network Core - E': 'Network',
        'BMS': 'Network',
        'Network Edge': 'Network',
        'AGG - EC2': 'Network',
        'CHRONOS': 'Network',
        'UMN': 'Network',
        'Network Border': 'Network',
        'Network Core': 'Network',
        'Network Enterpri': 'Network',
        'Network Manageme': 'Network',
        'Network L7 - JLB': 'Network',
        'Network Buffer': 'Network',
        'Network Optical': 'Network',
        'Network Aggregat': 'Network',
        'Network VPC-DX': 'Network',
        'Network Catzilla': 'Network',
        'Network L7': 'Network',
        'Network CI': 'Network',
        'Network Enterprise': 'Network',
        'Network Build': 'Network',
        '12.8T ES BFC SP': 'Network',
        '12.8T BFC BR': 'Network',
        '12.8T ES EUC SP': 'Network',
        'Fission': 'Network',
        'WS BFC BR': 'Network',
        'ES BFC SP': 'Network',
        'AGG - PROD': 'Network',
        'AGG-PROD': 'Network',
        'Agg - Prod': 'Network',
        'AGG - Prod': 'Network',
        'AGG-EC2': 'Network',
        'Agg - EC2': 'Network',
        'PATO': 'Network',
        'CI/NVR': 'Network',
        'BFC BR': 'Network',
        'Border': 'Network',
        'Optical': 'Network',
        'VPC': 'Network',
        'STORM': 'Network',
        'ES EUC SP': 'Network',
        'ES BFC BR': 'Network',
        'WS EUC SP': 'Network',
        'WS BFC SP': 'Network',
        'LBIR': 'Network',
        'Fusion Secondary': 'Network',
        'CI': 'Network',
        'WS UMN': 'Network',
        'ES UMN': 'Network',
        'L7-JLB': 'Network',
        'WMW Puffin Med': 'Network',
        'IRON RACK': 'Network',
        'Data Center Oper': 'Network',

        'CloudFront': 'Network',
        'Edge': 'Network',
        'Corp': 'Network',
        'DCO': 'Network',
        'FPOD': 'Network',
        'Migration Prog': 'Network',

        // EC2 类型
        'EC2': 'EC2',
        'Enterprise': 'EC2',
        'S3': 'EC2',

        // EBS 类型
        'EBS': 'EBS',

        // Production 类型
        'Production': 'Production',
        'AWS Prod': 'Production',
        'AWS-Prod': 'Production',
        'Bering Rack': 'Production',
        'Bering Tape Rack': 'Production',
        'SERVER': 'Production',
        'Classic-Prod': 'Production',
        'Classic Prod': 'Production',
        'GPS': 'Production',
        'AWS': 'Production',

        // Patch 类型
        'PATCH': 'Patch',
        'NONRACK': 'NonRack',
        'Thermal': 'Patch',
        'ATS': 'Patch',
        'IDF Row': 'Patch',
        'Bulk Fiber': 'Patch',

        // 其他特殊类型
        'Cabling Infrastr': 'Mini rack',
        'OH_MINIRACK': 'Mini rack',
    };

    // 获取Cloudforge位置信息
    async function fetchPositionInfo(site) {
        const urls = {
            position: `https://cloudforge-build.amazon.com/datacenters/${site}/equipments/floorplans/positions.json`,
            network: `https://cloudforge-build.amazon.com/datacenters/${site}/floorplans/network_connectivity.json`,
            euclid: `https://aha.bjs.aws-border.cn/blast-radius/api/get-euclid-bricks-for-site/${site}`
        };

        console.log('Fetching from URLs:', urls);

        const maxRetries = 3;
        const retryDelay = 500;

        async function fetchWithRetry(url, method, retryCount = 0) {
            try {
                const response = await makeRequest(url, method);
                return response;
            } catch (error) {
                if (retryCount < maxRetries) {
                    console.log(`Retry ${retryCount + 1} for ${url}`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1)));
                    return fetchWithRetry(url, method, retryCount + 1);
                }
                throw error;
            }
        }

        try {
            // 使用 Promise.allSettled 并行处理所有请求
            console.log('Starting parallel requests...');
            const [positionResult, networkResult, euclidResult] = await Promise.allSettled([
                makeRequest(urls.position, 'GET'),
                makeRequest(urls.network, 'GET'),
                makeRequest(urls.euclid, 'GET')
            ]);

            console.log('All requests completed. Results:', {
                position: positionResult.status,
                network: networkResult.status,
                euclid: euclidResult.status
            });


            // 检查核心数据是否成功
            if (positionResult.status === 'rejected') {
                throw new Error('Failed to fetch position data');
            }
            if (networkResult.status === 'rejected') {
                throw new Error('Failed to fetch network data');
            }

            // 处理位置数据
            console.log('Processing position data...');
            let positionData;
            try {
                positionData = JSON.parse(positionResult.value.responseText);
                if (positionData.errors) {
                    console.error('Position data contains errors:', positionData.errors);
                    positionData = {};
                }
            } catch (e) {
                console.error('Error parsing position data:', e);
                positionData = {};
            }

            // 处理网络数据
            console.log('Processing network data...');
            let networkData;
            try {
                networkData = JSON.parse(networkResult.value.responseText);
            } catch (e) {
                console.error('Error parsing network data:', e);
                networkData = {};
            }

            // 处理Euclid数据
            console.log('Processing Euclid data...');
            let hasEuclidAccess = false;
            let euclidData = {};
            if (euclidResult.status === 'fulfilled') {
                try {
                    euclidData = JSON.parse(euclidResult.value.responseText);
                    hasEuclidAccess = true;
                } catch (e) {
                    console.warn('Error parsing Euclid data:', e);
                }
            }

            // 创建网络数据映射
            console.log('Creating data mappings...');
            const networkDataMap = new Map();
            const euclidRacksMap = new Map();

            // 处理网络数据
            console.log('Processing network data mapping...');
            if (networkData && typeof networkData === 'object') {
                Object.entries(networkData).forEach(([_, item]) => {
                    if (item.position_id) {
                        networkDataMap.set(item.position_id, {
                            is_brick: item.is_brick || false
                        });
                    }
                });
            }

            // 处理Euclid数据
            console.log('Processing Euclid racks mapping...');
            if (hasEuclidAccess && euclidData && typeof euclidData === 'object') {
                Object.entries(euclidData).forEach(([assetId, brick]) => {
                    if (brick.rackAssetId) {
                        euclidRacksMap.set(brick.rackAssetId, {
                            brickHostName: brick.brickHostName,
                            euclidVersion: brick.euclidVersion,
                            downstreamRacks: brick.downstreamServerRacks || []
                        });
                    }
                });
            }

            // 创建最终的位置映射
            console.log('Creating final position map...');
            const newPositionMap = new Map();

            // 处理位置数据时整合所有信息
            if (positionData && typeof positionData === 'object' && Object.keys(positionData).length > 0) {
                Object.entries(positionData).forEach(([key, item]) => {
                    if (!item || typeof item !== 'object') return;

                    const networkInfo = networkDataMap.get(item.legacy_position_id) || {
                        is_brick: false
                    };

                    // 只在有 Euclid 访问权限时才添加 Euclid 信息
                    const euclidInfo = hasEuclidAccess && item.deployed_asset_id ?
                          euclidRacksMap.get(item.deployed_asset_id) : null;

                    // 判断部署状态
                    const isDeployed = !!item.deployed_asset_id;

                    // 只有在 deployed 状态时才处理 type
                    let rackType = 'unknown';
                    if (item.intended_customer) {
                        rackType = RACK_TYPE_MAPPING[item.intended_customer] || 'unknown';

                        // 如果类型是 unknown 或 intended_customer 是 ANY，则直接使用 uplink_fabric
                        if (rackType === 'unknown' || item.intended_customer === 'ANY') {
                            rackType = item.uplink_fabric.toUpperCase();
                        }
                    }

                    newPositionMap.set(`${item.room_name}-${item.name}`, {
                        status: item.disabled ? 'disabled' :
                        (isDeployed ? 'deployed' : 'undeployed'),
                        type: rackType.toUpperCase(),
                        power_kva: parseFloat(item.power_kva),
                        power_redundancy: item.power_redundancy,
                        deployed_asset_id: item.deployed_asset_id || null,
                        room_name: item.room_name,
                        name: item.name,
                        hasEuclidAccess: hasEuclidAccess,
                        is_brick: networkInfo.is_brick,
                        downstreamRacks: euclidInfo?.downstreamRacks || null
                    });
                });
            }

            console.log('Position map creation completed');
            return newPositionMap;

        } catch (error) {
            console.error('Error in fetchPositionInfo:', error);
            throw new Error(`Failed to fetch data for site ${site}: ${error.message}`);
        }
    }

    async function updateDisplay(filters) {
        window.updateProgress = (progress) => {
            const progressContainer = document.querySelector('.progress-container');
            if (progressContainer) {
                const progressFill = progressContainer.querySelector('.progress-fill');
                const progressText = progressContainer.querySelector('.progress-percentage');
                if (progressFill) progressFill.style.width = `${progress}%`;
                if (progressText) progressText.textContent = `${progress}%`;
            }
        };
        const topoView = document.querySelector('.topo-view');
        const filtersContainer = document.querySelector('.filters-container');
        if (!topoView) {
            console.error('Topo view element not found');
            return;
        }

        // 添加进度更新函数
        window.updateProgress = (progress) => {
            const progressContainer = document.querySelector('.progress-container');
            if (progressContainer) {
                const progressFill = progressContainer.querySelector('.progress-fill');
                const progressText = progressContainer.querySelector('.progress-percentage');
                if (progressFill) progressFill.style.width = `${progress}%`;
                if (progressText) progressText.textContent = `${progress}%`;
            }
        };

        let filteredData = EXCEL_DATA;

        try {
            const stats = {
                total: 0,
                detailedStats: {},
                euclidStats: {
                    'Lost Primary': 0,
                    'Lost Secondary': 0,
                    'Partial Power Loss': 0,
                    'Complete Power Loss': 0
                }
            };

            // 先获取每个位置应有的总电源数量（从原始数据）
            const expectedPowerByPosition = {};
            EXCEL_DATA.forEach(row => {
                const positionKey = `${row['Position Room']}-${row['Position']}`;
                if (!expectedPowerByPosition[positionKey]) {
                    expectedPowerByPosition[positionKey] = {
                        primary: 0,
                        secondary: 0,
                        allCircuits: []
                    };
                }
                if (row['Power Feed'].toLowerCase() === 'primary') {
                    expectedPowerByPosition[positionKey].primary++;
                } else if (row['Power Feed'].toLowerCase() === 'secondary') {
                    expectedPowerByPosition[positionKey].secondary++;
                }
                expectedPowerByPosition[positionKey].allCircuits.push({
                    powerFeed: row['Power Feed'],
                    circuitName: row['Circuit Name']
                });
            });

            // 应用筛选器
            Object.entries(filters).forEach(([column, values]) => {
                if (values && values.length > 0) {
                    filteredData = filteredData.filter(item => {
                        // 处理 rack type 和 status
                        if (column === 'type' || column === 'status') {
                            const positionKey = `${item['Position Room']}-${item['Position']}`;
                            const posInfo = positionMap.get(positionKey);
                            const value = column === 'type' ? posInfo?.type : posInfo?.status;
                            return values.includes(value);
                        }
                        // 处理 transformer 和 utility
                        else if (column === 'routingInfo.transformer' || column === 'routingInfo.utility') {
                            const routingValue = column === 'routingInfo.transformer' ?
                                  item.routingInfo?.transformer :
                            item.routingInfo?.utility;
                            return values.some(value => String(routingValue || '').trim() === String(value).trim());
                        }
                        // 处理其他普通字段
                        else {
                            const itemValue = String(item[column] || '').trim();
                            return values.some(value => String(value).trim() === itemValue);
                        }
                    });
                }
            });

            // 创建受影响的circuit集合
            const affectedCircuits = new Set(
                filteredData.map(row => row['Circuit Name'])
            );

            // 创建要显示的位置集合
            const positionsToShow = new Set();

            // 首先处理所有 Cloudforge 位置
            positionMap.forEach((posInfo, positionKey) => {
                let shouldShow = true;
                const powerRelatedFilters = ['PDU Name', 'UPS Group', 'USB', 'Power Feed', 'routingInfo.transformer', 'routingInfo.utility'];
                const hasPowerChainData = EXCEL_DATA.some(row =>
                                                          `${row['Position Room']}-${row['Position']}` === positionKey
                                                         );

                // 检查每个筛选条件
                Object.entries(filters).forEach(([column, values]) => {
                    if (!values || values.length === 0) return;

                    const isPowerRelated = powerRelatedFilters.includes(column);

                    // 如果是电力相关的筛选条件且该位置没有电力数据，则不显示
                    if (isPowerRelated && !hasPowerChainData) {
                        shouldShow = false;
                        return;
                    }

                    // 将 switch-case 改为 if-else 结构
                    if (column === 'type' || column === 'status') {
                        const valueToCheck = column === 'type' ?
                              (posInfo?.type || 'unknown').toUpperCase() :
                        (posInfo?.status || 'unknown');
                        shouldShow = shouldShow && values.includes(valueToCheck);
                    } else if (column === 'Position Room') {
                        const roomToCheck = posInfo.room_name;
                        shouldShow = shouldShow && values.includes(roomToCheck);
                    } else if (column === 'Position') {
                        const positionToCheck = posInfo.name;
                        shouldShow = shouldShow && values.includes(positionToCheck);
                    } else if (powerRelatedFilters.includes(column)) {
                        if (hasPowerChainData) {
                            const hasMatchingPower = EXCEL_DATA.some(row => {
                                if (`${row['Position Room']}-${row['Position']}` !== positionKey) return false;

                                if (column.startsWith('routingInfo.')) {
                                    const field = column.split('.')[1];
                                    return values.includes(row.routingInfo?.[field]);
                                } else {
                                    return values.includes(row[column]);
                                }
                            });
                            shouldShow = shouldShow && hasMatchingPower;
                        }
                    }
                });

                if (shouldShow) {
                    positionsToShow.add(positionKey);
                }
            });


            const usedCircuits = new Set(EXCEL_DATA.map(row => row['Circuit Name']));
            const positions = {};

            // 先从 positionMap 创建所有位置
            Array.from(positionMap.entries()).forEach(([positionKey, posInfo]) => {
                positions[positionKey] = {
                    site: getPositionSite(EXCEL_DATA),
                    room: posInfo.room_name,
                    position: posInfo.name,
                    status: posInfo.status || 'unknown',
                    type: (posInfo.type || 'unknown').toUpperCase(),
                    power_kva: posInfo.power_kva,
                    power_redundancy: posInfo.power_redundancy,
                    powerChains: [],
                    affectedPowerChains: []
                };
            });

            // 然后添加电力链路信息（如果有）
            EXCEL_DATA.forEach(row => {
                const positionKey = `${row['Position Room']}-${row['Position']}`;
                if (positions[positionKey]) {
                    const powerChain = {
                        circuit: {
                            name: row['Circuit Name'] || 'N/A',
                            number: row['Circuit Number'] || 'N/A'
                        },
                        pdu: {
                            name: row['PDU Name'] || 'N/A',
                            type: row['PDU Type'] || 'N/A'
                        },
                        upsGroup: row['UPS Group'] || 'N/A',
                        usb: row['USB'] || 'N/A',
                        powerFeed: row['Power Feed'] || 'N/A',
                        routingInfo: row.routingInfo || { transformer: 'N/A', utility: 'N/A' }
                    };

                    if (affectedCircuits.has(row['Circuit Name'])) {
                        positions[positionKey].affectedPowerChains.push(powerChain);
                    }
                    positions[positionKey].powerChains.push(powerChain);
                }
            });

            // 对于没有电力链路的位置，添加一个默认的 N/A 链路
            Object.keys(positions).forEach(positionKey => {
                if (positions[positionKey].powerChains.length === 0) {
                    positions[positionKey].powerChains.push({
                        circuit: { name: 'N/A', number: 'N/A' },
                        pdu: { name: 'N/A', type: 'N/A' },
                        upsGroup: 'N/A',
                        usb: 'N/A',
                        powerFeed: 'N/A',
                        routingInfo: { transformer: 'N/A', utility: 'N/A' }
                    });
                }
            });
            window.positions = positions;

            // 初始化统计数据结构
            const rackTypes = [...new Set(Object.values(positions).map(p => p.type.toUpperCase()))];
            rackTypes.forEach(type => {
                stats.detailedStats[type] = {
                    'Lost Primary': 0,
                    'Lost Secondary': 0,
                    'Partial Power Loss': 0,
                    'Complete Power Loss': 0,
                    'Total': 0
                };
            });

            // 计算统计信息
            async function processPositionBatch(entries, stats, expectedPowerByPosition, batchSize = 1000) {
                stats.patchRacks = {
                    total: 0,
                    positions: []
                };

                // 先统计所有 Patch 类型的机柜，不考虑电力信息
                Array.from(positionMap.entries()).forEach(([positionKey, posInfo]) => {
                    // 移除 status 检查，只要是 PATCH 类型就计数
                    if (posInfo?.type?.toUpperCase() === 'PATCH') {
                        stats.patchRacks.total++;
                        stats.patchRacks.positions.push({
                            room: posInfo.room_name,
                            position: posInfo.name
                        });
                    }
                });

                for (let i = 0; i < entries.length; i += batchSize) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                    const batch = entries.slice(i, i + batchSize);

                    for (const [positionKey, rows] of batch) {
                        const position = positions[positionKey];
                        const posInfo = positionMap.get(positionKey);

                        // 只处理 deployed 状态的位置
                        if (posInfo?.status === 'deployed' && posInfo?.type?.toUpperCase() !== 'PATCH') {
                            const type = (posInfo.type || 'unknown').toUpperCase();
                            const isEuclid = posInfo?.is_brick === true;

                            // 确保类型存在于统计中并初始化 euclidCount
                            if (!stats.detailedStats[type]) {
                                stats.detailedStats[type] = {
                                    'Lost Primary': 0,
                                    'Lost Secondary': 0,
                                    'Partial Power Loss': 0,
                                    'Complete Power Loss': 0,
                                    'Total': 0,
                                    euclidCount: {
                                        'Lost Primary': 0,
                                        'Lost Secondary': 0,
                                        'Partial Power Loss': 0,
                                        'Complete Power Loss': 0
                                    }
                                };
                            } else if (!stats.detailedStats[type].euclidCount) {
                                // 如果类型存在但没有 euclidCount，添加它
                                stats.detailedStats[type].euclidCount = {
                                    'Lost Primary': 0,
                                    'Lost Secondary': 0,
                                    'Partial Power Loss': 0,
                                    'Complete Power Loss': 0
                                };
                            }

                            // 增加总数统计
                            stats.detailedStats[type]['Total']++;

                            const hasPowerChainData = position.powerChains.some(chain => chain.circuit.name !== 'N/A');

                            // 如果没有 power chain 数据，则计为 Complete Power Loss
                            if (!hasPowerChainData) {
                                stats.detailedStats[type]['Complete Power Loss']++;
                                if (isEuclid) {
                                    stats.detailedStats[type].euclidCount['Complete Power Loss']++;
                                }
                                continue;
                            }

                            // 对于有 power chain 数据的位置，使用原有的统计逻辑
                            const expected = expectedPowerByPosition[positionKey];
                            if (!expected) continue;

                            const remainingPrimary = position.powerChains.filter(chain =>
                                                                                 chain.powerFeed.toLowerCase() === 'primary' &&
                                                                                 !position.affectedPowerChains.some(affected =>
                                                                                                                    affected.circuit.name === chain.circuit.name
                                                                                                                   )
                                                                                ).length;

                            const remainingSecondary = position.powerChains.filter(chain =>
                                                                                   chain.powerFeed.toLowerCase() === 'secondary' &&
                                                                                   !position.affectedPowerChains.some(affected =>
                                                                                                                      affected.circuit.name === chain.circuit.name
                                                                                                                     )
                                                                                  ).length;

                            const hasDualPower = expected.primary > 0 && expected.seconcondary > 0;

                            if (type === 'NETWORK') {
                                if (!hasDualPower) {
                                    // 单电源 NETWORK 机柜的处理
                                    if (remainingPrimary === 0 && expected.primary > 0) {
                                        stats.detailedStats[type]['Complete Power Loss']++;
                                        if (isEuclid) {
                                            stats.detailedStats[type].euclidCount['Complete Power Loss']++;
                                        }
                                    } else if (remainingPrimary < expected.primary) {
                                        stats.detailedStats[type]['Lost Primary']++;
                                        if (isEuclid) {
                                            stats.detailedStats[type].euclidCount['Lost Primary']++;
                                        }
                                    }
                                } else {
                                    // 双电源 NETWORK 机柜使用原有逻辑
                                    if (remainingPrimary === 0 && remainingSecondary === 0) {
                                        stats.detailedStats[type]['Complete Power Loss']++;
                                        if (isEuclid) stats.detailedStats[type].euclidCount['Complete Power Loss']++;
                                    } else if (remainingPrimary < expected.primary && remainingSecondary === expected.secondary) {
                                        stats.detailedStats[type]['Lost Primary']++;
                                        if (isEuclid) stats.detailedStats[type].euclidCount['Lost Primary']++;
                                    } else if (remainingSecondary < expected.secondary && remainingPrimary === expected.primary) {
                                        stats.detailedStats[type]['Lost Secondary']++;
                                        if (isEuclid) stats.detailedStats[type].euclidCount['Lost Secondary']++;
                                    } else if (remainingPrimary < expected.primary && remainingSecondary < expected.secondary) {
                                        stats.detailedStats[type]['Partial Power Loss']++;
                                        if (isEuclid) stats.detailedStats[type].euclidCount['Partial Power Loss']++;
                                    }
                                }
                            } else {
                                // 非 NETWORK 类型机柜的原有逻辑
                                if (remainingPrimary === 0 && remainingSecondary === 0 &&
                                    (expected.primary > 0 || expected.secondary > 0)) {
                                    stats.detailedStats[type]['Complete Power Loss']++;
                                    if (isEuclid) stats.detailedStats[type].euclidCount['Complete Power Loss']++;
                                } else if (hasDualPower) {
                                    if (remainingPrimary < expected.primary && remainingSecondary === expected.secondary) {
                                        stats.detailedStats[type]['Lost Primary']++;
                                        if (isEuclid) stats.detailedStats[type].euclidCount['Lost Primary']++;
                                    } else if (remainingSecondary < expected.secondary && remainingPrimary === expected.primary) {
                                        stats.detailedStats[type]['Lost Secondary']++;
                                        if (isEuclid) stats.detailedStats[type].euclidCount['Lost Secondary']++;
                                    } else if (remainingPrimary < expected.primary && remainingSecondary < expected.secondary) {
                                        stats.detailedStats[type]['Partial Power Loss']++;
                                        if (isEuclid) stats.detailedStats[type].euclidCount['Partial Power Loss']++;
                                    }
                                } else {
                                    if (expected.primary > 0 && remainingPrimary < expected.primary) {
                                        stats.detailedStats[type]['Partial Power Loss']++;
                                        if (isEuclid) stats.detailedStats[type].euclidCount['Partial Power Loss']++;
                                    }
                                }
                            }
                        }
                    }

                    const progress = Math.min(100, Math.round((i + batchSize) / entries.length * 100));
                    window.updateProgress(progress);
                }
            }

            // 创建数据Map并进行批处理
            const positionDataMap = new Map();
            EXCEL_DATA.forEach(row => {
                const positionKey = `${row['Position Room']}-${row['Position']}`;
                if (!positionDataMap.has(positionKey)) {
                    positionDataMap.set(positionKey, []);
                }
                positionDataMap.get(positionKey).push(row);
            });

            // 使用异步批处理
            await processPositionBatch(Array.from(positionDataMap.entries()), stats, expectedPowerByPosition);

            // 过滤掉总数为0的机柜类型
            const activeRackTypes = rackTypes.filter(type => {
                const typeStats = stats.detailedStats[type];
                if (!typeStats) return false;
                const totalCount = ['Lost Primary', 'Lost Secondary', 'Partial Power Loss', 'Complete Power Loss']
                .reduce((sum, metric) => sum + (typeStats[metric] || 0), 0);
                return totalCount > 0;
            });

            // 在处理 positions 时收集受影响的 Euclid racks
            const affectedEuclidRacks = new Set();

            Object.entries(positions).forEach(([key, position]) => {
                const posInfo = positionMap.get(key);
                if (position.status === 'deployed' && positionMap.get(key)?.downstreamRacks) {
                    // 检查这个 rack 是否受到影响
                    const isAffected = position.affectedPowerChains.length > 0;
                    if (isAffected) {
                        affectedEuclidRacks.add(key);
                    }
                }
            });

            // 统计下游机柜，只计算 deployed 的位置
            const uniqueDownstreamRacks = new Set();
            const downstreamRacksList = [];
            const hasEuclidAccess = Array.from(positionMap.values()).some(info => info.hasEuclidAccess);

            if (hasEuclidAccess) {
                affectedEuclidRacks.forEach(rackKey => {
                    const posInfo = positionMap.get(rackKey);
                    if (posInfo?.downstreamRacks) {
                        posInfo.downstreamRacks.forEach(downstream => {
                            const downstreamKey = `${downstream.room}-${downstream.position}`;
                            const downstreamPosInfo = positionMap.get(downstreamKey);

                            // 检查是否为 deployed 状态且不重复
                            if (downstreamPosInfo &&
                                downstreamPosInfo.status === 'deployed' &&
                                !uniqueDownstreamRacks.has(downstreamKey)) {

                                uniqueDownstreamRacks.add(downstreamKey);
                                downstreamRacksList.push({
                                    room: downstream.room,
                                    position: downstream.position
                                });
                            }
                        });
                    }
                });
            }

            const downstreamStats = {
                totalUniqueDownstream: uniqueDownstreamRacks.size,
                racksList: downstreamRacksList
            };

            // 生成统计表格 HTML
            const statsHtml = `
            <div class="stats-container">
                <div class="stats-tables-wrapper">
                    <div class="stats-details">
                        <table class="stats-table">
                            <thead>
                                <tr>
                                    <th>Power Status</th>
                                    ${activeRackTypes
            .filter(type => type !== 'PATCH')
            .map(type => `<th>${type === 'NETWORK' ? 'NETWORK(Euclid)' : type}</th>`)
            .join('')}
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${['Lost Primary', 'Lost Secondary', 'Partial Power Loss', 'Complete Power Loss'].map(metric => {
                                    const rowValues = activeRackTypes
                                    .filter(type => type !== 'PATCH')
                                    .map(type => {
                                        const total = stats.detailedStats[type][metric];
                                        const positionsArray = getPositionsForMetric(window.positions, type, metric);
                                        return generateStatsCell(type, metric, total, positionsArray);
                                    });
                                    const rowTotal = activeRackTypes
                                    .filter(type => type !== 'PATCH')
                                    .reduce((sum, type) => sum + (stats.detailedStats[type][metric] || 0), 0);
                                    return `
                                        <tr>
                                            <td>${metric}</td>
                                            ${rowValues.join('')}
                                            <td class="stats-cell">${rowTotal}</td>
                                        </tr>
                                    `;
                                }).join('')}
                                <tr class="total-row">
                                    <td>Total</td>
                                    ${activeRackTypes
            .filter(type => type !== 'PATCH')
            .map(type => {
                const totalCount = ['Lost Primary', 'Lost Secondary', 'Partial Power Loss', 'Complete Power Loss']
                .reduce((sum, metric) => sum + (stats.detailedStats[type][metric] || 0), 0);
                return generateStatsCell(type, 'Total', totalCount, []);
            }).join('')}
                                    <td class="stats-cell">${
                                        activeRackTypes
            .filter(type => type !== 'PATCH')
            .reduce((sum, type) =>
                    sum + ['Lost Primary', 'Lost Secondary', 'Partial Power Loss', 'Complete Power Loss']
                    .reduce((subSum, metric) => subSum + (stats.detailedStats[type][metric] || 0), 0), 0)
            }</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="side-stats">
                        ${Array.from(positionMap.values()).some(info => info.hasEuclidAccess) && downstreamStats.totalUniqueDownstream > 0 ? `
                            <div class="downstream-stats">
                                <table class="stats-table">
                                    <thead>
                                        <tr>
                                            <th>Network-connected rack</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td class="stats-cell clickable"
                                                data-positions='${JSON.stringify(downstreamRacksList)}'>
                                                ${downstreamStats.totalUniqueDownstream}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        ` : ''}
                        ${stats.patchRacks.total > 0 ? `
                            <div class="patch-stats">
                                <table class="stats-table">
                                    <thead>
                                        <tr>
                                            <th>Patch rack</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td class="stats-cell clickable"
                                                data-patch-positions='${JSON.stringify(stats.patchRacks.positions)}'>
                                                ${stats.patchRacks.total}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="export-button-container">
                    <button id="exportStatsBtn" class="export-button">
                        <span class="export-icon">📋</span> Copy
                    </button>
                </div>
            </div>`;

            // 渲染结果
            const positionsHtml = Object.entries(positions)
            .filter(([key]) => positionsToShow.has(key))
            .sort(([keyA], [keyB]) => String(keyA).localeCompare(String(keyB), undefined, {numeric: true}))
            .map(([key, position]) => {
                const positionInfo = positionMap.get(key);
                if (!positionInfo) {
                    console.warn(`No position info found for key: ${key}`);
                    return '';
                }

                const isEuclid = positionInfo.is_brick === true;

                return `
            <div class="topo-item ${isEuclid ? 'euclid-brick' : ''}">
                <div class="topo-item-header">
                    <div class="position-info">
                        <span class="status-indicator status-${positionInfo.status.toLowerCase() || 'unknown'}"></span>
                        <span class="position-id">${positionInfo.room_name} ${positionInfo.name}</span>
                        ${positionInfo.status === 'deployed' ?
                    `<span class="rack-type">${positionInfo.type || 'Unknown'}</span>` :
                ''
            }
                        ${positionInfo.power_redundancy ?
                    `<span class="power-redundancy">(${positionInfo.power_redundancy})</span>` :
                ''
            }
                        ${isEuclid ?
                    `<span class="euclid-tag">
                                ${positionInfo.deployed_asset_id ?
                    `<a href="https://aha.bjs.aws-border.cn/host-monitoring/euclid/${positionInfo.deployed_asset_id}"
                                        target="_blank"
                                        class="euclid-link">Euclid</a>` :
                'Euclid'
            }
                            </span>` :
                ''
            }
                    </div>
                    <div class="position-tags">
                        <span class="filter-tag status-tag-${positionInfo.status.toLowerCase() || 'unknown'}">
                            ${positionInfo.status || 'Unknown'}
                        </span>
                        <span class="filter-tag">Circuits: ${position.powerChains[0]?.circuit?.name === 'N/A' ? 0 : position.powerChains.length}</span>
                        ${positionInfo.power_kva ?
                    `<span class="filter-tag">Power: ${positionInfo.power_kva} kVA</span>` :
                ''
            }
                    </div>
                </div>
                <div class="topo-item-content">
                    ${position.powerChains.map(chain => `
                        <div class="power-chain ${chain.powerFeed === 'N/A' ? 'power-chain-na' : `power-chain-${chain.powerFeed.toLowerCase()}`}">
                            <div class="chain-header">
                                ${chain.powerFeed === 'N/A' ? 'No Power Chain Data' : `Power Feed: ${chain.powerFeed}`}
                            </div>
                            <div class="chain-path">
                                <div class="chain-item">
                                    <div class="chain-label">Circuit</div>
                                    <div class="chain-value">${chain.circuit.name}</div>
                                </div>
                                <div class="chain-arrow">→</div>
                                <div class="chain-item">
                                    <div class="chain-label">PDU</div>
                                    <div class="chain-value">${chain.pdu.name}</div>
                                </div>
                                <div class="chain-arrow">→</div>
                                <div class="chain-item">
                                    <div class="chain-label">UPS</div>
                                    <div class="chain-value">${chain.upsGroup}</div>
                                </div>
                                <div class="chain-arrow">→</div>
                                <div class="chain-item">
                                    <div class="chain-label">USB</div>
                                    <div class="chain-value">${chain.usb}</div>
                                </div>
                                <div class="chain-arrow">→</div>
                                <div class="chain-item">
                                    <div class="chain-label">Transformer</div>
                                    <div class="chain-value">${chain.routingInfo?.transformer || 'N/A'}</div>
                                </div>
                                <div class="chain-arrow">→</div>
                                <div class="chain-item">
                                    <div class="chain-label">Utility</div>
                                    <div class="chain-value">${chain.routingInfo?.utility || 'N/A'}</div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
            }).join('');

            let contentContainer = topoView.querySelector('.content-container');
            if (!contentContainer) {
                contentContainer = document.createElement('div');
                contentContainer.className = 'content-container';
                topoView.appendChild(contentContainer);
            }

            // 更新统计信息
            const statsContainer = contentContainer.querySelector('.stats-container');
            if (statsContainer) {
                statsContainer.innerHTML = statsHtml;
            } else {
                const newStatsContainer = document.createElement('div');
                newStatsContainer.className = 'stats-container';
                newStatsContainer.innerHTML = statsHtml;
                contentContainer.appendChild(newStatsContainer);
            }

            // 更新位置信息
            const positionsContainer = contentContainer.querySelector('.positions-container');
            if (positionsContainer) {
                positionsContainer.innerHTML = positionsHtml;
            } else {
                const newPositionsContainer = document.createElement('div');
                newPositionsContainer.className = 'positions-container';
                newPositionsContainer.innerHTML = positionsHtml;
                contentContainer.appendChild(newPositionsContainer);
            }

            // 只在第一次初始化筛选器
            if (!window.filtersInitialized) {
                initializeFilters(filtersContainer, stats);
                window.filtersInitialized = true;
            }
            function getPositionsForMetric(positionsObj, type, metric) {
                const result = [];
                Object.entries(positionsObj).forEach(([key, position]) => {
                    if (position.type.toUpperCase() !== type || position.status !== 'deployed') return;

                    const expected = expectedPowerByPosition[key];
                    if (!expected) return;

                    const remainingPrimary = position.powerChains.filter(chain =>
                                                                         chain.powerFeed.toLowerCase() === 'primary' &&
                                                                         !position.affectedPowerChains.some(affected =>
                                                                                                            affected.circuit.name === chain.circuit.name
                                                                                                           )
                                                                        ).length;

                    const remainingSecondary = position.powerChains.filter(chain =>
                                                                           chain.powerFeed.toLowerCase() === 'secondary' &&
                                                                           !position.affectedPowerChains.some(affected =>
                                                                                                              affected.circuit.name === chain.circuit.name
                                                                                                             )
                                                                          ).length;

                    const hasDualPower = expected.primary > 0 && expected.secondary > 0;

                    if (type === 'NETWORK') {
                        if (!hasDualPower) {
                            // 单电源 NETWORK 机柜
                            if (metric === 'Complete Power Loss' &&
                                remainingPrimary === 0 && expected.primary > 0) {
                                result.push(position.position);
                            } else if (metric === 'Lost Primary' &&
                                       remainingPrimary < expected.primary && remainingPrimary > 0) {
                                result.push(position.position);
                            }
                        } else {
                            // 双电源 NETWORK 机柜
                            if (metric === 'Complete Power Loss' &&
                                remainingPrimary === 0 && remainingSecondary === 0) {
                                result.push(position.position);
                            } else if (metric === 'Lost Primary' &&
                                       remainingPrimary < expected.primary &&
                                       remainingSecondary === expected.secondary) {
                                result.push(position.position);
                            } else if (metric === 'Lost Secondary' &&
                                       remainingSecondary < expected.secondary &&
                                       remainingPrimary === expected.primary) {
                                result.push(position.position);
                            } else if (metric === 'Partial Power Loss' &&
                                       remainingPrimary < expected.primary &&
                                       remainingSecondary < expected.secondary) {
                                result.push(position.position);
                            }
                        }
                    } else {
                        // 非 NETWORK 类型机柜的原有逻辑
                        if (metric === 'Complete Power Loss' &&
                            remainingPrimary === 0 && remainingSecondary === 0 &&
                            (expected.primary > 0 || expected.secondary > 0)) {
                            result.push(position.position);
                        } else if (hasDualPower) {
                            if (metric === 'Lost Primary' &&
                                remainingPrimary < expected.primary &&
                                remainingSecondary === expected.secondary) {
                                result.push(position.position);
                            } else if (metric === 'Lost Secondary' &&
                                       remainingSecondary < expected.secondary &&
                                       remainingPrimary === expected.primary) {
                                result.push(position.position);
                            } else if (metric === 'Partial Power Loss' &&
                                       remainingPrimary < expected.primary &&
                                       remainingSecondary < expected.secondary) {
                                result.push(position.position);
                            }
                        } else if (!hasDualPower &&
                                   metric === 'Partial Power Loss' &&
                                   expected.primary > 0 &&
                                   remainingPrimary < expected.primary) {
                            result.push(position.position);
                        }
                    }
                });
                return result;
            }

            // 添加点击事件
            document.querySelectorAll('.topo-item-header').forEach(header => {
                header.addEventListener('click', () => {
                    header.nextElementSibling.classList.toggle('active');
                });
            });

            // 在 updateDisplay 函数末尾添加按钮事件监听
            function setupExportButton() {
                const exportBtn = document.getElementById('exportStatsBtn');
                if (exportBtn) {
                    exportBtn.addEventListener('click', () => {
                        const markdown = generateStatsMarkdown(positions, activeRackTypes, stats);
                        copyToClipboard(markdown);
                        // 添加视觉反馈
                        const originalText = exportBtn.innerHTML;
                        exportBtn.innerHTML = '<span class="export-icon">✓</span> Copied!';
                        exportBtn.classList.add('copied');

                        setTimeout(() => {
                            exportBtn.innerHTML = '<span class="export-icon">📋</span> Copy';
                            exportBtn.classList.remove('copied');
                        }, 3000);
                    });
                }
            }
            setupModalEvents();
            setupExportButton();

        } catch (error) {
            console.error('Error updating display:', error);
            topoView.innerHTML = `
            <div class="error-message">
                Failed to update display: ${error.message}
            </div>
        `;
        }
    }

// 添加导出功能的实现
function generateStatsMarkdown(positions, activeRackTypes, stats) {
    let markdown = `| Power Status | ${activeRackTypes.join(' | ')} | Total |\n`;
    markdown += `|${'-'.repeat(13)}|${activeRackTypes.map(() => '-'.repeat(10)).join('|')}|${'-'.repeat(10)}|\n`;

    ['Lost Primary', 'Lost Secondary', 'Partial Power Loss', 'Complete Power Loss'].forEach(metric => {
        const rowValues = activeRackTypes.map(type => {
            const value = stats.detailedStats[type][metric] || 0;
            const euclidCount = stats.detailedStats[type].euclidCount?.[metric] || 0;
            return euclidCount > 0 ? `${value} (${euclidCount})` : value;
        });
        const rowTotal = activeRackTypes.reduce((sum, type) =>
                                                sum + (stats.detailedStats[type][metric] || 0), 0);
        markdown += `| ${metric} | ${rowValues.join(' | ')} | ${rowTotal} |\n`;
    });

    const totals = activeRackTypes.map(type =>
                                       ['Lost Primary', 'Lost Secondary', 'Partial Power Loss', 'Complete Power Loss']
                                       .reduce((sum, metric) => sum + (stats.detailedStats[type][metric] || 0), 0)
                                      );
    const finalTotal = totals.reduce((sum, val) => sum + val, 0);
    markdown += `| **Total** | ${totals.join(' | ')} | ${finalTotal} |\n`;

    return markdown;
}


// 添加复制到剪贴板的功能
async function copyToClipboard(text, button = null) {
    try {
        await navigator.clipboard.writeText(text);
        // 如果提供了按钮元素，显示视觉反馈
        if (button) {
            const originalText = button.innerHTML;
            button.innerHTML = '<span class="export-icon">✓</span> Copied!';
            button.classList.add('copied');

            setTimeout(() => {
                button.innerHTML = '<span class="export-icon">📋</span> Copy';
                button.classList.remove('copied');
            }, 3000);
        }
    } catch (err) {
        console.error('Failed to copy text:', err);
        // 回退方法
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            if (button) {
                const originalText = button.innerHTML;
                button.innerHTML = '<span class="export-icon">✓</span> Copied!';
                button.classList.add('copied');

                setTimeout(() => {
                    button.innerHTML = '<span class="export-icon">📋</span> Copy';
                    button.classList.remove('copied');
                }, 3000);
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            alert('Failed to copy to clipboard');
        }
        document.body.removeChild(textarea);
    }
}

// 初始化函数
async function init() {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            await loadExternalResources();

            // 验证依赖项是否正确加载
            if (!window.jQuery || !window.jQuery.fn.select2) {
                throw new Error('Required dependencies not loaded');
            }

            const container = setupInterface();
            document.getElementById('xwikicontent').appendChild(container);

            const loadingIndicator = container.querySelector('.loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }

            break; // 成功后退出循环
        } catch (error) {
            retryCount++;
            console.warn(`Initialization attempt ${retryCount} failed:`, error);

            if (retryCount === maxRetries) {
                console.error('Failed to initialize after multiple attempts:', error);
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error-message';
                errorDiv.textContent = `Failed to initialize after ${maxRetries} attempts: ${error.message}`;
                document.getElementById('xwikicontent').appendChild(errorDiv);
            } else {
                // 等待一段时间后重试
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            }
        }
    }
}


// 获取 Position Site 函数
function getPositionSite(data) {
    if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Invalid data: Empty or not an array');
    }

    const positionSite = data[0]['Position Site'];
    if (!positionSite) {
        throw new Error('Position Site not found in data');
    }

    return positionSite;
}

// 初始化筛选器
function initializeFilters(filtersContainer, stats) {
    if (typeof jQuery === 'undefined') {
        throw new Error('jQuery is not loaded');
    }
    if (typeof jQuery.fn.select2 === 'undefined') {
        throw new Error('Select2 is not loaded');
    }

    filtersContainer.innerHTML = '';

    const filters = getFilterOptions();
    filters.forEach(filter => {
        const filterSection = document.createElement('div');
        filterSection.className = 'filter-section';

        const label = document.createElement('label');
        label.textContent = filter.label;

        const select = $('<select>', {
            class: 'filter-select',
            multiple: true,
            'data-column': filter.column,
            'data-is-position': filter.isPosition
        });

        // 根据不同的列类型添加选项
        if (filter.column === 'Position Room') {
            // 从 positionMap 获取所有房间
            const rooms = [...new Set(
                Array.from(positionMap.values()).map(info => info.room_name)
            )].filter(Boolean);
            rooms.sort().forEach(room => {
                select.append(new Option(room, room));
            });
        } else if (filter.column === 'Position') {
            // 从 positionMap 获取所有位置
            const positions = [...new Set(
                Array.from(positionMap.values()).map(info => info.name)
            )].filter(Boolean);
            positions.sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true}))
                .forEach(position => {
                select.append(new Option(position, position));
            });
        } else if (filter.column === 'type' && stats) {
            const activeRackTypes = Object.keys(stats.detailedStats)
            .filter(type => {
                return stats.detailedStats[type]['Total'] > 0 ||
                    (type === 'PATCH' && stats.patchRacks && stats.patchRacks.total > 0);
            })
            .sort();
            select.empty();
            if (activeRackTypes.length > 0) {
                activeRackTypes.forEach(type => {
                    const option = new Option(type, type);
                    select.append(option);
                });
            } else {
                select.append(new Option('No Types Available', ''));
            }
        } else if (filter.column === 'status') {
            ['deployed', 'undeployed', 'disabled'].forEach(status => {
                select.append(new Option(
                    status.charAt(0).toUpperCase() + status.slice(1),
                    status
                ));
            });
        } else {
            // 只为有电力数据的位置添加电力相关的选项
            const options = [...new Set(EXCEL_DATA
                                        .map(item => {
                if (filter.column.startsWith('routingInfo.')) {
                    const field = filter.column.split('.')[1];
                    return item.routingInfo?.[field];
                }
                return item[filter.column];
            })
                                        .filter(Boolean)
                                       )].sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true}));

            options.forEach(option => {
                select.append(new Option(option, option));
            });
        }

        filterSection.appendChild(label);
        $(filterSection).append(select);

        // Select2 初始化
        select.select2({
            placeholder: `Select ${filter.label}`,
            allowClear: true,
            closeOnSelect: false,
            width: '100%',
            selectOnClose: false,
            minimumResultsForSearch: 10,
            dropdownAutoWidth: true,
            dropdownParent: filterSection,
            templateSelection: function(data, container) {
                const selected = select.val();
                if (selected && selected.length > 1) {
                    if ($(container).is(':first-child')) {
                        return `${selected.length} items selected`;
                    }
                    return '';
                }
                return data.text;
            }
        });

        filtersContainer.appendChild(filterSection);
    });

    // 修改筛选逻辑
    const activeFilters = {};
    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        }
    }
    // 创建防抖版本的updateDisplay
    const debouncedUpdateDisplay = debounce((filters) => {
        updateDisplay(filters);
    }, 300);

    // 修改事件处理
    $('.filter-select').on('change', function() {
        const column = $(this).data('column');
        const values = $(this).val() || [];

        if (values.length > 0) {
            activeFilters[column] = values.map(value => String(value).trim());
        } else {
            delete activeFilters[column];
        }

        debouncedUpdateDisplay(activeFilters);
    });
    return activeFilters;
}

//添加统计表格弹窗生成
function generateStatsCell(type, metric, displayValue, positions) {
    // 如果值为0，直接返回不可点击的单元格
    if (displayValue === 0) return `<td class="stats-cell">0</td>`;

    // 检查是否是 total 行
    if (metric === 'Total') {
        return `<td class="stats-cell">${displayValue}</td>`;
    }

    // 计算 Euclid 数量
    const euclidCount = positions.filter(position => {
        const matchingKey = Object.entries(window.positions).find(([key, pos]) => {
            return pos.position === position && pos.type.toUpperCase() === type;
        })?.[0];
        if (!matchingKey) return false;
        const posInfo = positionMap.get(matchingKey);
        return posInfo?.is_brick === true;  // 直接检查 is_brick
    }).length;

    // 生成显示文本
    const displayText = euclidCount > 0 ? `${displayValue} (${euclidCount})` : displayValue;

    return `
    <td class="stats-cell clickable"
        data-type="${type}"
        data-metric="${metric}"
        data-positions='${JSON.stringify(positions)}'>
        ${displayText}
    </td>
`;
}

function setupModalEvents() {
    const modal = document.querySelector('.position-modal');
    const backdrop = document.querySelector('.modal-backdrop');

    if (!modal || !backdrop) {
        console.error('Modal elements not found');
        return;
    }

    function closeModal() {
        modal.style.display = 'none';
        backdrop.style.display = 'none';
    }

    // 确保每次打开modal时都重新绑定关闭事件
    function setupCloseButton() {
        const closeBtn = modal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.replaceWith(closeBtn.cloneNode(true));
            const newCloseBtn = modal.querySelector('.modal-close');
            newCloseBtn.addEventListener('click', closeModal);
        }
    }

    backdrop.addEventListener('click', closeModal);

    document.querySelectorAll('.stats-cell.clickable').forEach(cell => {
        cell.addEventListener('click', () => {
            try {
                // 判断是主表格的单元格还是下游机柜的单元格
                if (cell.dataset.type && cell.dataset.metric) {
                    const type = cell.dataset.type;
                    const metric = cell.dataset.metric;
                    const positions = JSON.parse(cell.dataset.positions);

                    // 获取这些位置中的 Euclid positions
                    const euclidPositions = positions.filter(position => {
                        const matchingPosition = Object.entries(window.positions).find(([key, pos]) => {
                            return pos.position === position && pos.type.toUpperCase() === type;
                        });
                        if (!matchingPosition) return false;
                        const [positionKey] = matchingPosition;
                        const posInfo = positionMap.get(positionKey);
                        return posInfo?.is_brick === true;
                    });

                    // 生成包含 Euclid 标识的位置文本
                    const positionsTextWithEuclid = positions
                    .sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true}))
                    .map(position => {
                        const matchingPosition = Object.entries(window.positions).find(([key, pos]) => {
                            return pos.position === position && pos.type.toUpperCase() === type;
                        });
                        if (!matchingPosition) return position;
                        const [positionKey] = matchingPosition;
                        const posInfo = positionMap.get(positionKey);
                        return posInfo?.is_brick ? `${position}(Euclid)` : position;
                    })
                    .join('\n');

                    modal.querySelector('.modal-header').innerHTML = `
                <div class="modal-title">${type} - ${metric} (${positions.length} positions${
                    euclidPositions.length > 0 ? `, ${euclidPositions.length} Euclid` : ''
                })</div>
                <div class="modal-actions">
                    <button id="copyPositionsBtn" class="copy-positions-button">
                        <span class="export-icon">📋</span> Copy
                    </button>
                    <div class="modal-close">&times;</div>
                </div>
            `;

                    // 生成位置列表
                    modal.querySelector('.position-list').innerHTML = positions
                        .sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true}))
                        .map(position => {
                        const matchingPosition = Object.entries(window.positions).find(([key, pos]) => {
                            return pos.position === position && pos.type.toUpperCase() === type;
                        });

                        if (!matchingPosition) return '';

                        const [positionKey] = matchingPosition;
                        const posInfo = positionMap.get(positionKey);
                        const isEuclid = posInfo?.is_brick === true;
                        const deployedAssetId = posInfo?.deployed_asset_id;

                        return `
                        <div class="position-item ${isEuclid ? 'euclid-position' : ''}">
                            <span class="position-name">${position}</span>
                            ${isEuclid ? `
                                <span class="euclid-indicator">
                                    ${deployedAssetId ?
                            `<a href="https://aha.bjs.aws-border.cn/host-monitoring/euclid/${deployedAssetId}"
                                            target="_blank"
                                            class="euclid-link">Euclid</a>` :
                        'Euclid'
                    }
                                </span>
                            ` : ''}
                        </div>
                    `;
                    })
                        .filter(html => html)
                        .join('');

                    // 添加复制按钮的事件监听器
                    const copyBtn = modal.querySelector('#copyPositionsBtn');
                    if (copyBtn) {
                        // 移除旧的事件监听器
                        copyBtn.replaceWith(copyBtn.cloneNode(true));
                        const newCopyBtn = modal.querySelector('#copyPositionsBtn');

                        newCopyBtn.addEventListener('click', () => {
                            copyToClipboard(positionsTextWithEuclid, newCopyBtn);
                        });
                    }

                    modal.style.display = 'block';
                    backdrop.style.display = 'block';
                    setupCloseButton();
                } else if (cell.dataset.patchPositions) {
                    // 处理 Patch rack 的点击
                    const positions = JSON.parse(cell.dataset.patchPositions);

                    // 生成包含房间号的位置文本
                    const positionsText = positions
                    .sort((a, b) => {
                        const aCompare = `${a.room} ${a.position}`;
                        const bCompare = `${b.room} ${b.position}`;
                        return String(aCompare).localeCompare(String(bCompare), undefined, {numeric: true});
                    })
                    .map(pos => `${pos.room} ${pos.position}`)
                    .join('\n');

                    modal.querySelector('.modal-header').innerHTML = `
                    <div class="modal-title">Patch racks (${positions.length} positions)</div>
                    <div class="modal-actions">
                        <button id="copyPositionsBtn" class="copy-positions-button">
                            <span class="export-icon">📋</span> Copy
                        </button>
                        <div class="modal-close">&times;</div>
                    </div>
                `;

                    modal.querySelector('.position-list').innerHTML = positions
                        .sort((a, b) => {
                        const aCompare = `${a.room} ${a.position}`;
                        const bCompare = `${b.room} ${b.position}`;
                        return String(aCompare).localeCompare(String(bCompare), undefined, {numeric: true});
                    })
                        .map(position => `
                        <div class="position-item">
                            <span class="position-name">${position.room} ${position.position}</span>
                        </div>
                    `).join('');

                    // 添加复制按钮的事件监听器
                    const copyBtn = modal.querySelector('#copyPositionsBtn');
                    if (copyBtn) {
                        copyBtn.replaceWith(copyBtn.cloneNode(true));
                        const newCopyBtn = modal.querySelector('#copyPositionsBtn');
                        newCopyBtn.addEventListener('click', () => {
                            copyToClipboard(positionsText, newCopyBtn);
                        });
                    }

                    modal.style.display = 'block';
                    backdrop.style.display = 'block';
                    setupCloseButton();
                } else {
                    // 下游机柜单元格处理逻辑
                    const positions = JSON.parse(cell.dataset.positions || '[]');

                    if (!positions.length) {
                        console.log('No downstream positions found');
                        return;
                    }

                    modal.querySelector('.modal-title').textContent =
                        `Network-connected racks (${positions.length} positions)`;

                    modal.querySelector('.position-list').innerHTML = positions
                        .sort((a, b) => String(a.position).localeCompare(String(b.position), undefined, {numeric: true}))
                        .map(position => {
                        return `
                            <div class="position-item">
                                <span class="position-name">${position.position}</span>
                            </div>
                        `;
                    })
                        .join('');
                }

                modal.style.display = 'block';
                backdrop.style.display = 'block';

            } catch (error) {
                console.error('Error handling cell click:', error);
            }
        });
    });
}

GM_addStyle(`

.site-selection-section {
padding: 20px;
margin-bottom: 20px;
background: #f8f9fa;
border-radius: 6px;
text-align: center;
}

.site-selection-section h2 {
margin-bottom: 15px;
color: #1976d2;
}

.custom-dropdown {
position: relative;
width: 300px;
margin: 0 auto;
}

.selected-option {
padding: 10px 15px;
border: 1px solid #ddd;
border-radius: 4px;
background-color: white;
cursor: pointer;
user-select: none;
}

.selected-option:hover {
background-color: #f8f9fa;
}

.selected-option:focus {
outline: none;
box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2);
}

.dropdown-options {
display: none;
position: absolute;
top: 100%;
left: 0;
right: 0;
max-height: 200px;
overflow-y: auto;
background-color: white;
border: 1px solid #ddd;
border-top: none;
border-radius: 0 0 4px 4px;
box-shadow: 0 2px 4px rgba(0,0,0,0.1);
z-index: 1000;
}

.dropdown-options li {
padding: 10px 15px;
cursor: pointer;
}

.dropdown-options li:hover {
background-color: #f8f9fa;
}

.loading-indicator {
margin-top: 15px;
color: #1976d2;
font-weight: bold;
}

/* 基础容器样式 */
.topo-container {
width: 100%;
background: white;
padding: 20px;
border: 1px solid #ccc;
border-radius: 8px;
box-shadow: 0 2px 10px rgba(0,0,0,0.1);
margin: 20px 0;
display: flex;
flex-direction: column;
}

/* 筛选器容器样式调整 */
.filters-container {
display: flex !important;
flex-direction: row !important;
flex-wrap: nowrap !important;
gap: 15px;
padding: 15px;
background: #f5f5f5;
border-radius: 6px;
margin-bottom: 15px;
max-height: none !important;
overflow-x: auto !important;
overflow-y: hidden !important;
white-space: nowrap;
align-items: flex-start;
}

/* 筛选器部分样式 */
.filter-section {
flex: 0 0 auto;
min-width: 200px;
width: 200px !important;
margin-bottom: 0 !important;
}

/* 标签样式 */
.filter-section label {
white-space: nowrap;
display: block;
margin-bottom: 5px;
}

/* Select2 容器样式调整 */
.select2-container {
min-width: 200px !important;
width: 200px !important;
margin-bottom: 0 !important;
}

.select2-container--default .select2-selection--multiple .select2-selection__choice:not(:first-child) {
display: none;
}

.select2-container--default .select2-selection--multiple .select2-selection__choice:first-child {
max-width: 100%;
overflow: hidden;
text-overflow: ellipsis;
}

/* 滚动条样式 */
.filters-container::-webkit-scrollbar {
height: 6px;
width: auto;
}

.filters-container::-webkit-scrollbar-track {
background: #f1f1f1;
border-radius: 3px;
}

.filters-container::-webkit-scrollbar-thumb:hover {
background: #555;
}

/* 统计信息样式 */
.stats-container {
padding: 15px;
margin: 10px 0;
background: #e3f2fd;
border-radius: 6px;
font-size: 0.9em;
}

.stats-header {
margin-bottom: 10px;
padding-bottom: 10px;
border-bottom: 1px solid #90caf9;
}

.stats-details {
overflow-x: auto; /* 允许在需要时横向滚动 */
}

.stats-type-item {
display: flex;
justify-content: space-between;
align-items: center;
padding: 8px 12px;
background: rgba(255, 255, 255, 0.7);
border-radius: 4px;
transition: background-color 0.2s;
}

.stats-type-item:hover {
background: rgba(255, 255, 255, 0.9);
}

.stats-type-label {
font-weight: bold;
color: #1976d2;
}

.stats-type-value {
background: #fff;
padding: 2px 8px;
border-radius: 4px;
color: #1976d2;
font-weight: bold;
}

.stats-item {
display: flex;
align-items: center;
gap: 10px;
}

.stats-label {
font-weight: bold;
color: #1976d2;
}

.stats-value {
background: #fff;
padding: 2px 8px;
border-radius: 4px;
color: #1976d2;
font-weight: bold;
}

.stats-table {
width: 100%;
border-collapse: collapse;
margin-top: 15px;
background: white;
box-shadow: 0 1px 3px rgba(0,0,0,0.1);
table-layout: fixed; /* 确保列宽一致 /
min-width: 100%; / 确保表格在容器中正确显示 */
}

.stats-table th,
.stats-table td {
padding: 12px;
text-align: center;
border: 1px solid #e0e0e0;
background: transparent; /* 确保背景透明 */
}

.stats-table th {
background: #f5f5f5;
font-weight: bold;
color: #333;
font-size: 14px;
white-space: nowrap; /* 防止表头文字换行 */
}

.stats-table th:first-child,
.stats-table td:first-child {
width: 180px; /* 固定第一列宽度 */
text-align: left;
font-weight: bold;
background: #f5f5f5;
}

.stats-cell {
font-family: 'Arial', sans-serif;
font-weight: bold;
color: #000000;
font-size: 14px;
}

.warning-cell:not(:empty):not([data-value="0"]) {
background-color: transparent; /* 移除警告背景色 /
color: #000000; / 使用黑色文字 */
font-weight: bold;
}

.stats-table tr:last-child {
background-color: #e3f2fd;
}

.stats-table tr:last-child td {
font-weight: bold;
color: #1976d2;
}

.total-row {
background-color: #f5f5f5 !important;
}

.total-row td {
font-weight: bold;
border-top: 2px solid #90caf9;
}

/* 右侧总计列样式 */
.stats-table th:last-child,
.stats-table td:last-child {
background-color: #f5f5f5;
font-weight: bold;
border-left: 2px solidlid #e0e0e0;
}

/* 确保表格在容器中正确显示的响应式样式 */
@media (max-width: 1200px) {
.stats-details {
margin: 0 -15px;
padding: 0 15px;
}

.stats-table {
margin: 15px 0;
}

}

/* 下拉菜单样式 */
.filter-select {
width: 100%;
padding: 8px;
border: 1px solid #ddd;
border-radius: 4px;
background-color: white;
cursor: pointer;
font-size: 14px;
}

.filter-select:hover {
border-color: #aaa;
}

.filter-select:focus {
outline: none;
border-color: #2196F3;
box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.1);
}

/* 主视图容器 */
.topo-view {
flex: 1;
overflow-y: auto;
padding: 15px;
background: #fff;
border: 1px solid #eee;
border-radius: 6px;
}

/* Position 项样式 */
.topo-item {
background: #fff;
margin-bottom: 10px;
border: 1px solid #ddd;
border-radius: 6px;
box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.topo-item-header {
padding: 12px 15px;
background: #f8f9fa;
cursor: pointer;
display: flex;
justify-content: space-between;
align-items: center;
border-bottom: 1px solid #eee;
font-weight: bold;
border-radius: 6px 6px 0 0;
}

.topo-item-header:hover {
background: #e9ecef;
}

.topo-item-content {
padding: 15px;
display: none;
background: #fff;
}

.topo-item-content.active {
display: block;
}

/* 电力链路样式 */
.power-chain {
margin: 15px 0;
padding: 15px;
background: #f8f9fa;
border-radius: 8px;
border: 1px solid #e9ecef;
}

.power-chain-primary {
border-left: 4px solid #4CAF50;
}

.power-chain-secondary {
border-left: 4px solid #2196F3;
}

.power-redundancy {
font-size: 0.9em;
color: #666;
margin-left: 5px;
}

.chain-header {
font-weight: bold;
margin-bottom: 10px;
padding-bottom: 5px;
border-bottom: 1px solid #dee2e6;
}

.chain-path {
display: flex;
align-items: center;
gap: 15px;
flex-wrap: nowrap;
margin: 15px 0;
padding: 15px;
background: white;
border-radius: 6px;
overflow-x: auto;
}

.chain-item {
flex: 0 0 auto;
padding: 10px 15px;
background: #f8f9fa;
border: 1px solid #dee2e6;
border-radius: 6px;
min-width: 140px;
}

.chain-label {
font-size: 0.85em;
color: #666;
margin-bottom: 4px;
}

.chain-value {
font-weight: 500;
word-break: break-word;
}

.chain-arrow {
color: #adb5bd;
font-weight: bold;
flex: 0 0 auto;
}

/* 标签样式 */
.filter-tags {
display: flex;
gap: 8px;
}

.filter-tag {
padding: 2px 8px;
background: #e9ecef;
border-radius: 4px;
font-size: 0.85em;
color: #666;
}

/* 滚动条美化 */
.chain-path::-webkit-scrollbar {
height: 6px;
}

.chain-path::-webkit-scrollbar-track {
background: #f1f1f1;
border-radius: 3px;
}

.chain-path::-webkit-scrollbar-thumb {
background: #ccc;
border-radius: 3px;
}

.chain-path::-webkit-scrollbar-thumb:hover {
background: #999;
}

/* 错误状态 */
.error-message {
color: #f44336;
padding: 10px;
margin: 10px 0;
background: #fee;
border-radius: 4px;
border: 1px solid #fdd;
}

/* 响应式调整 */
@media (max-width: 1200px) {
.chain-path {
padding: 10px;
gap: 10px;
}

.chain-item {
min-width: 120px;
padding: 8px 12px;
}

}

/* 状态指示器样式 */
.status-indicator {
width: 8px;
height: 8px;
border-radius: 50%;
display: inline-block;
margin-right: 8px;
}

.status-deployed {
background-color: #4CAF50;
}

.status-undeployed {
background-color: #FFC107;
}

.status-disabled {
background-color: #F44336;
}

.status-unknown {
background-color: #9E9E9E;
}

/* 状态标签样式 */
.status-tag-deployed {
background-color: #E8F5E9;
color: #2E7D32;
}

.status-tag-undeployed {
background-color: #FFF3E0;
color: #F57C00;
}

.status-tag-disabled {
background-color: #FFEBEE;
color: #C62828;
}

/* 类型标签样式 */
.rack-type {
font-size: 0.9em;
padding: 2px 8px;
border-radius: 4px;
background-color: #E3F2FD;
color: #1976D2;
margin-left: 8px;
}

/* Euclid brick 样式 */
.euclid-brick {
border: 2px solid #2196F3 !important;
background-color: rgba(33, 150, 243, 0.05);
}

.euclid-tag {
background-color: #2196F3 !important;
color: white !important;
padding: 2px 8px !important;
border-radius: 4px !important;
font-size: 0.8em !important;
margin-left: 8px !important;
font-weight: bold !important;
}

.euclid-link {
color: white !important;
text-decoration: none;
}

.euclid-link:hover {
text-decoration: underline;
}

/* 确保链接不会影响标签的样式 */
.euclid-tag a {
color: inherit;
text-decoration: none;
}

/* 站点选择器的 Select2 样式 */
.site-selection-section .select2-container {
width: 300px !important;
margin: 0 auto;
}

.site-selection-section .select2-container--default .select2-selection--single {
height: 38px;
padding: 4px;
border: 1px solid #ddd;
border-radius: 4px;
background-color: white;
}

.site-selection-section .select2-container--default .select2-selection--single .select2-selection__rendered {
line-height: 28px;
color: #333;
}

.site-selection-section .select2-container--default .select2-selection--single .select2-selection__arrow {
height: 36px;
}

.site-dropdown {
z-index: 9999;
border: 1px solid #ddd;
border-radius: 4px;
box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.site-dropdown .select2-results__option {
padding: 8px 12px;
}

.site-dropdown .select2-results__option--highlighted[aria-selected] {
background-color: #2196F3;
}

/* 确保下拉菜单始终可见 */
.select2-dropdown {
z-index: 9999 !important;
}

.select2-container--open {
z-index: 9999 !important;
}

.topo-container {
margin-top: 20px;
}

.loading-indicator {
padding: 15px;
margin-bottom: 15px;
text-align: center;
background: #f8f9fa;
border-radius: 4px;
color: #1976d2;
font-weight: bold;
}

.site-selector-container {
margin-bottom: 20px;
padding: 15px;
background: #f8f9fa;
border-radius: 6px;
text-align: center;
}

.site-selector-container h2 {
margin-bottom: 15px;
color: #1976d2;
}

.site-select {
width: 300px;
padding: 8px;
font-size: 16px;
border: 1px solid #ddd;
border-radius: 4px;
}

.position-modal {
display: none;
position: fixed;
top: 50%;
left: 50%;
transform: translate(-50%, -50%);
background-color: white;
padding: 20px;
border-radius: 10px;
box-shadow: 0 2px 10px rgba(0,0,0,0.2);
z-index: 1000;
min-width: 400px;
max-width: 90vw;
max-height: 80vh;
overflow-y: auto;
width: auto;
}

.modal-header {
display: flex;
justify-content: space-between;
align-items: center;
margin-bottom: 15px;
padding-bottom: 10px;
border-bottom: 1px solid #eee;
}

.modal-title {
font-size: 1.2em;
font-weight: bold;
color: #1976d2;
margin-right: 20px;
}

.modal-actions {
display: flex;
align-items: center;
gap: 10px;
}

.copy-positions-button {
display: flex;
align-items: center;
gap: 4px;
padding: 4px 8px;
background-color: #1976d2;
color: white;
border: none;
border-radius: 4px;
cursor: pointer;
font-size: 12px;
transition: background-color 0.2s;
}

.copy-positions-button:hover {
background-color: #1565c0;
}

.copy-positions-button.copied {
background-color: #4caf50;
}

.copy-positions-button .export-icon {
font-size: 13px;
}

.modal-close {
cursor: pointer;
padding: 5px;
font-size: 1.5em;
line-height: 1;
color: #666;
margin-left: 10px;
}

.modal-content {
margin-bottom: 15px;
}

.position-list {
display: grid;
grid-template-columns: repeat(3, minmax(100px, auto));
gap: 10px;
padding: 10px;
width: fit-content;
margin: 0 auto;
}

.position-item {
padding: 8px 12px;
background: #f8f9fa;
border-radius: 4px;
border: 1px solid #e0e0e0;
display: flex;
align-items: center;
justify-content: space-between;
min-width: 100px;
width: auto;
}

.position-name {
flex: 0 0 auto;
margin-right: 10px;
}

.euclid-indicator {
flex: 0 0 auto;
background-color: #2196F3;
color: white;
padding: 2px 6px;
border-radius: 3px;
font-size: 0.8em;
white-space: nowrap;
}

.euclid-indicator a {
color: white !important;
text-decoration: none;
}

.euclid-indicator a:hover {
text-decoration: underline;
}

.euclid-position {
background-color: #E3F2FD !important;
border: 1px solid #90CAF9 !important;
}

@media (max-width: 480px) {
.position-list {
grid-template-columns: 1fr;
}
}

.stats-cell.clickable {
cursor: pointer;
transition: background-color 0.2s;
}

.stats-cell.clickable:hover {
background-color: #f5f5f5;  /* hover时的背景色 */
}

.modal-backdrop {
display: none;
position: fixed;
top: 0;
left: 0;
right: 0;
bottom: 0;
background-color: rgba(0,0,0,0.5);
z-index: 999;
}

.stats-tables-wrapper {
display: flex;
gap: 20px;
align-items: flex-start;
}

.stats-details {
flex: 1;
}

.downstream-stats {
width: 200px;
vertical-align: middle;
overflow: hidden;
}

.stats-table {
width: 120px;
max-width: 100%;
box-sizing: border-box;
}

.downstream-stats .stats-table,
.patch-stats .stats-table {
width: 100%;
margin: 0 auto;
border-collapse: collapse;
margin-top: 15px;
background: white;
box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.downstream-stats .stats-table th,
.patch-stats .stats-table th {
text-align: center;
padding: 12px;
background: #f5f5f5;
font-weight: bold;
color: #333;
font-size: 14px;
white-space: nowrap;
border: 1px solid #e0e0e0;
}

.downstream-stats .stats-cell,
.patch-stats .stats-cell {
text-align: center !important;
padding: 12px;
font-weight: bold;
color: #000000;
font-size: 14px;
border: 1px solid #e0e0e0;
height: 43px;
}

    .downstream-stats .stats-cell a,
        .patch-stats .stats-cell a {
            text-align: center;
            display: block;
            width: 100%;
            color: #1976d2;
        }

.downstream-stats .stats-cell.clickable {
    cursor: pointer;
    transition: background-color 0.2s;
}

.downstream-stats .stats-cell.clickable:hover {
    background-color: #f5f5f5;
}

.progress-container {
    margin: 20px 0;
    padding: 20px;
    background: #f8f9fa;
    border-radius: 8px;
    text-align: center;
}

.progress-bar {
    width: 100%;
    height: 20px;
    background: #e9ecef;
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 10px;
}

.progress-fill {
    width: 0%;
    height: 100%;
    background: #2196F3;
    transition: width 0.3s ease;
    background-image: linear-gradient(
        45deg,
        rgba(255, 255, 255, 0.15) 25%,
        transparent 25%,
            transparent 50%,
                rgba(255, 255, 255, 0.15) 50%,
                    rgba(255, 255, 255, 0.15) 75%,
                        transparent 75%,
                            transparent
                            );
    background-size: 1rem 1rem;
    animation: progress-bar-stripes 1s linear infinite;
}

@keyframes progress-bar-stripes {
    0% { background-position: 1rem 0; }
    100% { background-position: 0 0; }
}

.progress-text {
    font-size: 14px;
    color: #666;
    margin-bottom: 5px;
}

.progress-step {
    font-size: 12px;
    color: #999;
}

.export-button-container {
    display: flex;
    justify-content: center;
    margin-top: 15px;
}

.export-button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    background-color: #1976d2;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: background-color 0.2s;
}

.export-button:hover {
    background-color: #1565c0;
}

.export-button.copied {
    background-color: #4caf50;
}

.export-icon {
    font-size: 13px;
}

.side-stats {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.patch-stats {
    width: 200px;
    vertical-align: middle;
    overflow: hidden;
}
`);

// 修改页面加载初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

})();
