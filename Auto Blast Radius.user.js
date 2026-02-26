// ==UserScript==
// @name         Auto Blast Radius
// @namespace    http://tampermonkey.net/
// @version      1.5
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
// @connect      sentry.amazon.com
// @connect      sso.amazon.com
// @connect      idp.amazon.com
// @connect      *.aws-border.cn
// @connect      *.amazon.com
// @connect      ncfs-api.corp.amazon.com
// @updateURL    https://github.com/GuitarV/Auto-Blast-Radius/raw/refs/heads/main/Auto%20Blast%20Radius.user.js
// @downloadURL  https://github.com/GuitarV/Auto-Blast-Radius/raw/refs/heads/main/Auto%20Blast%20Radius.user.js

// ==/UserScript==
(function() {
    'use strict';

    const loadExternalResources = async () => {
        if (typeof jQuery === 'undefined') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        if (typeof jQuery.fn.select2 === 'undefined') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/select2/4.1.0-rc.0/js/select2.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

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
    window.filteredPositions = {};
    const LAMBDA_URL = 'https://twuukpz75g.execute-api.us-west-2.amazonaws.com/default/GetS3Data';

    const AVAILABLE_SITES = [
        'BJS9', 'BJS10', 'BJS11', 'BJS12', 'BJS20', 'BJS50', 'BJS51',
        'BJS52', 'BJS60', 'BJS70', 'BJS71', 'BJS73', 'BJS74',
        'BJS80', 'PEK7', 'PEK50', 'PKX140',
    ];

    // 设置界面函数
    function setupInterface() {
        const xwikiContent = document.getElementById('xwikicontent');
        if (!xwikiContent) {
            throw new Error('Target container #xwikicontent not found');
        }

        const container = document.createElement('div');
        container.className = 'topo-container';

        // 站点选择区域
        const siteSection = document.createElement('div');
        siteSection.className = 'site-selection-section';
        siteSection.innerHTML = `
            <h2>Select Data Center Site (V1.5)</h2>
            <div class="custom-dropdown">
                <div class="selected-option" tabindex="0">Select a Site</div>
                <ul class="dropdown-options">
                    ${AVAILABLE_SITES.map(site => `<li data-value="${site}">${site}</li>`).join('')}
                </ul>
            </div>
        `;
        container.appendChild(siteSection);

        // Tips 容器 - 默认显示但折叠
        const tipsContainer = document.createElement('div');
        tipsContainer.className = 'tips-container collapsed';
        tipsContainer.innerHTML = `
            <div class="tips-header">
                <div class="tips-title">
                    <span class="tips-icon">💡</span>
                    <span>Tips</span>
                </div>
                <div class="tips-toggle">▼</div>
            </div>
            <div class="tips-content">
                <ul class="tips-list">
                    <li><strong>Summary Table：</strong>目前表格中只统计Deployed状态的机柜，Patch Rack不计入其中</li>
                    <li><strong>Detail Info：</strong>已自动过滤Floorplan中的Non-rack和Mini-rack位置</li>
                    <li><strong>点击查看：</strong>点击Summary Table中的数字可查看详细机柜列表</li>
                </ul>
            </div>
        `;
        container.appendChild(tipsContainer);

        // 模态框
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = `
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
        container.appendChild(modalContainer);

        // 加载指示器
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'loading-indicator';
        loadingIndicator.style.display = 'none';
        container.appendChild(loadingIndicator);

        // 筛选器容器
        const filtersContainer = document.createElement('div');
        filtersContainer.className = 'filters-container';
        filtersContainer.style.display = 'none';
        container.appendChild(filtersContainer);

        // 进度条容器
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

        // 视图容器
        const topoView = document.createElement('div');
        topoView.className = 'topo-view';
        topoView.style.display = 'none';
        container.appendChild(topoView);
        xwikiContent.appendChild(container);

        // 下拉菜单逻辑
        const dropdown = container.querySelector('.custom-dropdown');
        const selectedOption = dropdown.querySelector('.selected-option');
        const optionsList = dropdown.querySelector('.dropdown-options');

        selectedOption.addEventListener('click', () => {
            optionsList.style.display = optionsList.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', (event) => {
            if (!dropdown.contains(event.target)) {
                optionsList.style.display = 'none';
            }
        });

        // 站点选择处理
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

                    const updateProgress = (percentage, step) => {
                        progressFill.style.width = `${percentage}%`;
                        progressText.textContent = `${percentage}%`;
                        progressStep.textContent = step;
                    };

                    updateProgress(10, 'Loading site topology data😀...');
                    const data = await loadDataFromLambda(selectedSite);
                    if (!data || !Array.isArray(data)) {
                        throw new Error('Invalid data format received');
                    }

                    updateProgress(20, 'Processing data🤣...');
                    EXCEL_DATA = data;

                    updateProgress(40, 'Getting position site...');
                    const site = getPositionSite(EXCEL_DATA);

                    updateProgress(50, 'Fetching position info (Maybe 1-2 mins🤔)...');
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

        // Tips 折叠
        const tipsHeader = container.querySelector('.tips-header');
        if (tipsHeader) {
            tipsHeader.addEventListener('click', function() {
                const tipsContainer = this.closest('.tips-container');
                tipsContainer.classList.toggle('collapsed');
            });
        }

        return container;
    }

    // ==================== CSV 解析函数 ====================

    function parseCSVContent(csvText) {
        console.log('[CSV Parser] Input type:', typeof csvText);
        console.log('[CSV Parser] Input length:', csvText ? csvText.length : 0);
        console.log('[CSV Parser] Input preview:', csvText ? csvText.substring(0, 200) : 'null/empty');

        if (!csvText || typeof csvText !== 'string') {
            console.warn('[CSV Parser] Invalid input, returning empty array');
            return [];
        }

        const lines = csvText.trim().split('\n');
        console.log('[CSV Parser] Total lines:', lines.length);

        if (lines.length === 0) return [];

        const headers = parseCSVLine(lines[0]);
        console.log('[CSV Parser] Headers:', headers);

        const data = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = parseCSVLine(line);
            const row = {};
            headers.forEach((header, index) => {
                row[header.trim()] = (values[index] || '').trim();
            });
            data.push(row);
        }

        console.log('[CSV Parser] Parsed rows:', data.length);
        if (data.length > 0) {
            console.log('[CSV Parser] First row sample:', data[0]);
        }

        return data;
    }

    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result.map(val => val.replace(/^"|"$/g, '').replace(/""/g, '"'));
    }

    // UPS 路由映射
    function createUPSRoutingMap(secondaryData) {
        console.log('[Routing Map] Secondary data type:', typeof secondaryData);
        console.log('[Routing Map] Secondary data is array:', Array.isArray(secondaryData));
        console.log('[Routing Map] Secondary data length:', secondaryData ? secondaryData.length : 0);

        const routingMap = {
            usbMap: new Map(),
            upsGroupMap: new Map()
        };

        if (!Array.isArray(secondaryData)) {
            console.warn('[Routing Map] Secondary data is not array, returning empty map');
            return routingMap;
        }

        secondaryData.forEach((item, index) => {
            if (index === 0) {
                console.log('[Routing Map] First secondary item:', item);
            }

            const routingInfo = {
                transformer: item.Transformer || item.transformer,
                utility: item.Utility || item.utility
            };

            if (item.USB || item.usb) {
                routingMap.usbMap.set(item.USB || item.usb, routingInfo);
            }
            if (item['UPS Group'] || item.ups_group) {
                routingMap.upsGroupMap.set(item['UPS Group'] || item.ups_group, routingInfo);
            }
        });

        console.log('[Routing Map] USB map size:', routingMap.usbMap.size);
        console.log('[Routing Map] UPS Group map size:', routingMap.upsGroupMap.size);

        return routingMap;
    }

    // 从 Lambda 加载数据
    async function loadDataFromLambda(site) {
        console.log('========================================');
        console.log('[LoadData] Starting load for site:', site);
        console.log('[LoadData] Lambda URL:', LAMBDA_URL);
        console.log('========================================');

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: LAMBDA_URL,
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYmpzZGNlbyIsInR5cGUiOiJwZXJtYW5lbnQifQ.mKaIWhj_d7kxB8fwh2BDDGKMyVLrkiwZZzuZzc8ra6s",
                },
                data: JSON.stringify({ site: site, cluster:'bjs' }),
                onload: function(response) {
                    console.log('[LoadData] Response received');
                    console.log('[LoadData] Status:', response.status);
                    console.log('[LoadData] Status Text:', response.statusText);
                    console.log('[LoadData] Response headers:', response.responseHeaders);
                    console.log('[LoadData] Response text length:', response.responseText ? response.responseText.length : 0);
                    console.log('[LoadData] Response text preview (first 500 chars):',
                        response.responseText ? response.responseText.substring(0, 500) : 'empty');

                    try {
                        if (response.status === 200) {
                            console.log('[LoadData] Status 200 OK, parsing response...');

                            let responseData;
                            try {
                                responseData = JSON.parse(response.responseText);
                                console.log('[LoadData] JSON parsed successfully');
                                console.log('[LoadData] Response data keys:', Object.keys(responseData));
                            } catch (jsonError) {
                                console.error('[LoadData] JSON parse error:', jsonError);
                                console.error('[LoadData] Raw response:', response.responseText);
                                reject(new Error(`JSON parse error: ${jsonError.message}`));
                                return;
                            }

                            // 获取数据
                            let primaryRaw, secondaryRaw;

                            console.log('[LoadData] Checking response structure...');
                            console.log('[LoadData] Has body?', !!responseData.body);
                            console.log('[LoadData] Body type:', typeof responseData.body);

                            if (responseData.body) {
                                console.log('[LoadData] Parsing body...');
                                let bodyData;
                                try {
                                    bodyData = typeof responseData.body === 'string' ?
                                        JSON.parse(responseData.body) : responseData.body;
                                    console.log('[LoadData] Body parsed, keys:', Object.keys(bodyData));
                                } catch (bodyError) {
                                    console.error('[LoadData] Body parse error:', bodyError);
                                    console.error('[LoadData] Body content:', responseData.body);
                                    reject(new Error(`Body parse error: ${bodyError.message}`));
                                    return;
                                }
                                primaryRaw = bodyData.primary_data;
                                secondaryRaw = bodyData.secondary_data;
                            } else {
                                console.log('[LoadData] No body wrapper, using direct data');
                                primaryRaw = responseData.primary_data;
                                secondaryRaw = responseData.secondary_data;
                            }

                            console.log('[LoadData] Primary data type:', typeof primaryRaw);
                            console.log('[LoadData] Primary data is array:', Array.isArray(primaryRaw));
                            console.log('[LoadData] Secondary data type:', typeof secondaryRaw);
                            console.log('[LoadData] Secondary data is array:', Array.isArray(secondaryRaw));

                            if (typeof primaryRaw === 'string') {
                                console.log('[LoadData] Primary data preview (first 300 chars):',
                                    primaryRaw.substring(0, 300));
                            } else if (Array.isArray(primaryRaw)) {
                                console.log('[LoadData] Primary data length:', primaryRaw.length);
                                if (primaryRaw.length > 0) {
                                    console.log('[LoadData] Primary first item:', primaryRaw[0]);
                                }
                            }

                            // 判断数据类型并解析
                            let primaryData, secondaryData;

                            if (typeof primaryRaw === 'string') {
                                console.log('[LoadData] Parsing as CSV format...');
                                primaryData = parseCSVContent(primaryRaw);
                                secondaryData = parseCSVContent(secondaryRaw || '');
                            } else if (Array.isArray(primaryRaw)) {
                                console.log('[LoadData] Using as JSON array format...');
                                primaryData = primaryRaw;
                                secondaryData = secondaryRaw || [];
                            } else {
                                console.error('[LoadData] Unknown data format');
                                console.error('[LoadData] primaryRaw:', primaryRaw);
                                reject(new Error('Unknown data format'));
                                return;
                            }

                            console.log('[LoadData] Final primary data count:', primaryData ? primaryData.length : 0);
                            console.log('[LoadData] Final secondary data count:', secondaryData ? secondaryData.length : 0);

                            if (!primaryData || primaryData.length === 0) {
                                console.error('[LoadData] No primary data after parsing');
                                reject(new Error(`No primary data available for site ${site}`));
                                return;
                            }

                            // 创建路由映射
                            console.log('[LoadData] Creating routing map...');
                            const routingMap = createUPSRoutingMap(secondaryData);

                            // 处理数据
                            console.log('[LoadData] Enriching data with routing info...');
                            const enrichedData = primaryData.map((item, index) => {
                                if (index === 0) {
                                    console.log('[LoadData] Processing first item:', item);
                                }

                                const cleanedItem = {
                                    'Position Site': item['Position Site'] || site,
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

                                let routingInfo = cleanedItem.USB ?
                                    routingMap.usbMap.get(cleanedItem.USB) : null;

                                if (!routingInfo && cleanedItem['UPS Group']) {
                                    routingInfo = routingMap.upsGroupMap.get(cleanedItem['UPS Group']);
                                }

                                if (!routingInfo) {
                                    routingInfo = { transformer: 'Unknown', utility: 'Unknown' };
                                }

                                return { ...cleanedItem, routingInfo };
                            });

                            console.log('[LoadData] Enriched data count:', enrichedData.length);
                            if (enrichedData.length > 0) {
                                console.log('[LoadData] First enriched item:', enrichedData[0]);
                            }

                            console.log('[LoadData] SUCCESS - Resolving with data');
                            console.log('========================================');
                            resolve(enrichedData);

                        } else {
                            console.error('[LoadData] Non-200 status:', response.status);
                            console.error('[LoadData] Response text:', response.responseText);
                            reject(new Error(`Failed to load data for ${site} (Status: ${response.status})`));
                        }
                    } catch (error) {
                        console.error('[LoadData] Catch block error:', error);
                        console.error('[LoadData] Error stack:', error.stack);
                        reject(new Error(`Unable to process data for ${site}: ${error.message}`));
                    }
                },
                onerror: (error) => {
                    console.error('[LoadData] Network error:', error);
                    reject(new Error('Network error'));
                },
                ontimeout: () => {
                    console.error('[LoadData] Request timeout');
                    reject(new Error('Request timed out'));
                }
            });
        });
    }

    function getFilterOptions() {
        return [
            { label: 'Data Hall', column: 'Position Room' },
            { label: 'Rack', column: 'Position', isPosition: true },
            { label: 'PDU Name', column: 'PDU Name' },
            { label: 'UPS Group', column: 'UPS Group' },
            { label: 'USB', column: 'USB' },
            { label: 'Transformer', column: 'routingInfo.transformer' },
            { label: 'Utility', column: 'routingInfo.utility' },
            { label: 'Power Feed', column: 'Power Feed' },
            { label: 'Rack Status', column: 'status' },
            { label: 'Rack Type', column: 'type' },
            { label: 'Capacity', column: 'power_kva' }
        ];
    }

    window.ahaLoginWindowOpened = false;

    function makeRequest(url, method, retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 200;
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: method,
                url: url,
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout: 90000,
                withCredentials: true,
                onload: function(response) {
                    if (response.status === 200) {
                        resolve(response);
                    } else if (url.includes('cloudforge-build.amazon.com') && (response.status === 401 || response.status === 403)) {
                        if (retryCount < maxRetries) {
                            window.open('https://cloudforge-build.amazon.com/', '_blank');
                            setTimeout(() => makeRequest(url, method, retryCount + 1).then(resolve).catch(reject), retryDelay * (retryCount + 1));
                        } else {
                            reject(new Error('Please login to Cloudforge first'));
                        }
                    } else {
                        if (retryCount < maxRetries) {
                            setTimeout(() => makeRequest(url, method, retryCount + 1).then(resolve).catch(reject), retryDelay * (retryCount + 1));
                        } else {
                            reject(new Error(`Request failed with status ${response.status}`));
                        }
                    }
                },
                onerror: function(error) {
                    if (retryCount < maxRetries && !url.includes('aha.bjs.aws-border.cn')) {
                        setTimeout(() => makeRequest(url, method, retryCount + 1).then(resolve).catch(reject), retryDelay * (retryCount + 1));
                    } else {
                        reject(error);
                    }
                },
                ontimeout: function() {
                    if (retryCount < maxRetries && !url.includes('aha.bjs.aws-border.cn')) {
                        setTimeout(() => makeRequest(url, method, retryCount + 1).then(resolve).catch(reject), retryDelay * (retryCount + 1));
                    } else {
                        reject(new Error('Request timed out'));
                    }
                }
            });
        });
    }

    // ==================== Part 3 开始 ====================

    const RACK_TYPE_MAPPING = {
        'NETWORK': 'Network', 'Security': 'Network', 'Fusion Even Prim': 'Network', 'Fusion Odd Prim': 'Network',
        'Network Core - W': 'Network', 'Network Core - E': 'Network', 'BMS': 'Network', 'Network Edge': 'Network',
        'AGG - EC2': 'Network', 'CHRONOS': 'Network', 'UMN': 'Network', 'Network Border': 'Network',
        'Network Core': 'Network', 'Network Enterpri': 'Network', 'Network Manageme': 'Network',
        'Network L7 - JLB': 'Network', 'Network Buffer': 'Network', 'Network Optical': 'Network',
        'Network Aggregat': 'Network', 'Network VPC-DX': 'Network', 'Network Catzilla': 'Network',
        'Network L7': 'Network', 'Network CI': 'Network', 'Network Enterprise': 'Network', 'Network Build': 'Network',
        '12.8T ES BFC SP': 'Network', '12.8T BFC BR': 'Network', '12.8T ES EUC SP': 'Network', 'Fission': 'Network',
        'WS BFC BR': 'Network', 'ES BFC SP': 'Network', 'AGG - PROD': 'Network', 'AGG-PROD': 'Network',
        'Agg - Prod': 'Network', 'AGG - Prod': 'Network', 'AGG-EC2': 'Network', 'Agg - EC2': 'Network',
        'PATO': 'Network', 'CI/NVR': 'Network', 'BFC BR': 'Network', 'Border': 'Network', 'Optical': 'Network',
        'VPC': 'Network', 'STORM': 'Network', 'ES EUC SP': 'Network', 'ES BFC BR': 'Network', 'WS EUC SP': 'Network',
        'WS BFC SP': 'Network', 'LBIR': 'Network', 'Fusion Secondary': 'Network', 'CI': 'Network',
        'WS UMN': 'Network', 'ES UMN': 'Network', 'L7-JLB': 'Network', 'WMW Puffin Med': 'Network',
        'IRON RACK': 'Network', 'Data Center Oper': 'Network', 'Bulk Fiber': 'Network', 'CloudFront': 'Network',
        'Edge': 'Network', 'Corp': 'Network', 'DCO': 'Network', 'FPOD': 'Network', 'Migration Prog': 'Network',
        'EC2': 'EC2', 'Enterprise': 'EC2', 'S3': 'EC2', 'EBS': 'EBS',
        'Production': 'Production', 'AWS Prod': 'Production', 'AWS-Prod': 'Production', 'Bering Rack': 'Production',
        'Bering Tape Rack': 'Production', 'SERVER': 'Production', 'Classic-Prod': 'Production',
        'Classic Prod': 'Production', 'GPS': 'Production', 'AWS': 'Production',
        'PATCH': 'Patch', 'NONRACK': 'NonRack', 'Thermal': 'Patch', 'ATS': 'Patch', 'IDF Row': 'Patch',
        'Cabling Infrastr': 'Mini rack', 'OH_MINIRACK': 'Mini rack',
    };

    async function fetchPositionInfo(site) {
        const urls = {
            position: `https://cloudforge-build.amazon.com/datacenters/${site}/equipments/floorplans/positions.json`,
            network: `https://cloudforge-build.amazon.com/datacenters/${site}/floorplans/network_connectivity.json`
        };

        try {
            const [positionResult, networkResult] = await Promise.allSettled([
                makeRequest(urls.position, 'GET'),
                makeRequest(urls.network, 'GET')
            ]);

            if (positionResult.status === 'rejected') throw new Error('Failed to fetch position data');
            if (networkResult.status === 'rejected') throw new Error('Failed to fetch network data');

            let positionData = {};
            try { positionData = JSON.parse(positionResult.value.responseText); } catch (e) { positionData = {}; }

            let networkData = {};
            try { networkData = JSON.parse(networkResult.value.responseText); } catch (e) { networkData = {}; }

            const networkDataMap = new Map();
            const euclidBricks = [];

            if (networkData && typeof networkData === 'object') {
                Object.entries(networkData).forEach(([_, item]) => {
                    if (item.position_id) {
                        networkDataMap.set(item.position_id, { is_brick: item.is_brick || false, hostname: item.hostname || null });
                        if (item.is_brick && item.hostname) {
                            euclidBricks.push({ position_id: item.position_id, hostname: item.hostname });
                        }
                    }
                });
            }

            const assetIdToPositionMap = new Map();
            if (positionData && typeof positionData === 'object') {
                Object.entries(positionData).forEach(([key, item]) => {
                    if (item.deployed_asset_id) {
                        assetIdToPositionMap.set(item.deployed_asset_id, { room: item.room_name, position: item.name });
                    }
                });
            }

            const downstreamRacksMap = new Map();
            if (euclidBricks.length > 0) {
                const batchSize = 5;
                for (let i = 0; i < euclidBricks.length; i += batchSize) {
                    const batch = euclidBricks.slice(i, i + batchSize);
                    const promises = batch.map(async (brick) => {
                        try {
                            const response = await makeRequest(`https://ncfs-api.corp.amazon.com/public/bricks/rack_mapping?brick=${brick.hostname}`, 'GET');
                            if (response.status !== 200) return { position_id: brick.position_id, downstreamRacks: [] };
                            const data = JSON.parse(response.responseText);
                            const downstreamRacks = [];
                            const seenAssetIds = new Set();
                            Object.values(data).flat().forEach(rack => {
                                if (rack.asset_id && !seenAssetIds.has(rack.asset_id)) {
                                    seenAssetIds.add(rack.asset_id);
                                    const posInfo = assetIdToPositionMap.get(rack.asset_id);
                                    if (posInfo) {
                                        downstreamRacks.push({ room: posInfo.room, position: posInfo.position, asset_id: rack.asset_id, rack_type: rack.rack_type, fabric: rack.fabric });
                                    }
                                }
                            });
                            return { position_id: brick.position_id, downstreamRacks };
                        } catch (error) {
                            return { position_id: brick.position_id, downstreamRacks: [] };
                        }
                    });
                    const results = await Promise.all(promises);
                    results.forEach(result => downstreamRacksMap.set(result.position_id, result.downstreamRacks));
                    if (i + batchSize < euclidBricks.length) await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            const newPositionMap = new Map();
            if (positionData && typeof positionData === 'object') {
                Object.entries(positionData).forEach(([key, item]) => {
                    if (!item || typeof item !== 'object') return;
                    if (item.type === 'OH_MINIRACK' || item.type === 'NONRACK') return;

                    const networkInfo = networkDataMap.get(item.legacy_position_id) || { is_brick: false, hostname: null };
                    const downstreamRacks = networkInfo.is_brick ? downstreamRacksMap.get(item.legacy_position_id) || [] : null;
                    const isDeployed = !!item.deployed_asset_id;

                    let rackType = 'unknown';
                    if (item.intended_customer) {
                        rackType = RACK_TYPE_MAPPING[item.intended_customer] || 'unknown';
                        if (rackType === 'unknown' || item.intended_customer === 'ANY') rackType = item.uplink_fabric.toUpperCase();
                        if (rackType === 'Network' && parseFloat(item.power_kva) === 0) rackType = 'Patch';
                    }

                    newPositionMap.set(`${item.room_name}-${item.name}`, {
                        status: item.disabled ? 'disabled' : (isDeployed ? 'deployed' : 'undeployed'),
                        type: rackType.toUpperCase(),
                        power_kva: parseFloat(item.power_kva),
                        power_redundancy: item.power_redundancy,
                        deployed_asset_id: item.deployed_asset_id || null,
                        room_name: item.room_name,
                        name: item.name,
                        is_brick: networkInfo.is_brick,
                        hostname: networkInfo.hostname,
                        downstreamRacks: downstreamRacks
                    });
                });
            }

            return newPositionMap;
        } catch (error) {
            throw new Error(`Failed to fetch data for site ${site}: ${error.message}`);
        }
    }

    function getPositionSite(data) {
        if (!Array.isArray(data) || data.length === 0) throw new Error('Invalid data');
        const positionSite = data[0]['Position Site'];
        if (!positionSite) throw new Error('Position Site not found');
        return positionSite;
    }

    function initializeFilters(filtersContainer, stats) {
        filtersContainer.innerHTML = '';
        const filters = getFilterOptions();

        filters.forEach(filter => {
            const filterSection = document.createElement('div');
            filterSection.className = 'filter-section';

            const label = document.createElement('label');
            label.textContent = filter.label;

            const select = $('<select>', { class: 'filter-select', multiple: true, 'data-column': filter.column });

            if (filter.column === 'Position Room') {
                const rooms = [...new Set(Array.from(positionMap.values()).map(info => info.room_name))].filter(Boolean);
                rooms.sort().forEach(room => select.append(new Option(room, room)));
            } else if (filter.column === 'Position') {
                const positions = [...new Set(Array.from(positionMap.values()).map(info => info.name))].filter(Boolean);
                positions.sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true})).forEach(position => select.append(new Option(position, position)));
            } else if (filter.column === 'type' && stats) {
                const activeRackTypes = Object.keys(stats.detailedStats).filter(type => stats.detailedStats[type]['Total'] > 0 || (type === 'PATCH' && stats.patchRacks?.total > 0)).sort();
                activeRackTypes.forEach(type => select.append(new Option(type, type)));
            } else if (filter.column === 'status') {
                ['deployed', 'undeployed', 'disabled'].forEach(status => select.append(new Option(status.charAt(0).toUpperCase() + status.slice(1), status)));
            } else if (filter.column === 'power_kva') {
                const capacities = [...new Set(Array.from(positionMap.values()).map(info => info.power_kva).filter(kva => kva !== null && kva !== undefined))].sort((a, b) => a - b);
                capacities.forEach(capacity => select.append(new Option(capacity, capacity)));
            } else {
                const options = [...new Set(EXCEL_DATA.map(item => {
                    if (filter.column.startsWith('routingInfo.')) return item.routingInfo?.[filter.column.split('.')[1]];
                    return item[filter.column];
                }).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true}));
                options.forEach(option => select.append(new Option(option, option)));
            }

            filterSection.appendChild(label);
            $(filterSection).append(select);

            select.select2({
                placeholder: `Select ${filter.label}`,
                allowClear: true,
                closeOnSelect: false,
                width: '100%',
                minimumResultsForSearch: 10,
                dropdownParent: filterSection,
                templateSelection: function(data, container) {
                    const selected = select.val();
                    if (selected && selected.length > 1) {
                        if ($(container).is(':first-child')) return `${selected.length} items selected`;
                        return '';
                    }
                    return data.text;
                }
            });

            filtersContainer.appendChild(filterSection);
        });

        // 初始化筛选逻辑为 AND
        window.filterLogic = 'and';

        // 逻辑切换按钮事件
        const logicBtns = document.querySelectorAll('.logic-btn');
        logicBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                logicBtns.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                window.filterLogic = this.dataset.logic;

                // 触发筛选更新
                const activeFilters = {};
                $('.filter-select').each(function() {
                    const column = $(this).data('column');
                    const values = $(this).val() || [];
                    if (values.length > 0) {
                        activeFilters[column] = values.map(value => String(value).trim());
                    }
                });
                debouncedUpdateDisplay(activeFilters);
            });
        });

        const activeFilters = {};
        function debounce(fn, delay) {
            let timer;
            return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); }
        }
        const debouncedUpdateDisplay = debounce((filters) => updateDisplay(filters), 300);

        $('.filter-select').on('change', function() {
            const column = $(this).data('column');
            const values = $(this).val() || [];
            if (values.length > 0) activeFilters[column] = values.map(value => String(value).trim());
            else delete activeFilters[column];
            debouncedUpdateDisplay(activeFilters);
        });

        return activeFilters;
    }

    // ==================== Part 4a 开始 ====================

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
        if (!topoView) return;

        let filteredData = EXCEL_DATA;

        try {
            const stats = { total: 0, detailedStats: {}, euclidStats: { 'Lost Primary': 0, 'Lost Secondary': 0, 'Partial Power Loss': 0, 'Complete Power Loss': 0 } };
            const expectedPowerByPosition = {};

            EXCEL_DATA.forEach(row => {
                const positionKey = `${row['Position Room']}-${row['Position']}`;
                if (!expectedPowerByPosition[positionKey]) {
                    expectedPowerByPosition[positionKey] = { primary: 0, secondary: 0, allCircuits: [] };
                }
                if (row['Power Feed'].toLowerCase() === 'primary') expectedPowerByPosition[positionKey].primary++;
                else if (row['Power Feed'].toLowerCase() === 'secondary') expectedPowerByPosition[positionKey].secondary++;
                expectedPowerByPosition[positionKey].allCircuits.push({ powerFeed: row['Power Feed'], circuitName: row['Circuit Name'] });
            });

            // 获取当前筛选逻辑
            const filterLogic = window.filterLogic || 'and';

            // 检查单个数据项是否匹配某个筛选条件
            const checkItemMatchesFilter = (item, column, values) => {
                if (!values || values.length === 0) return true; // 没有值则视为匹配

                if (column === 'type' || column === 'status') {
                    const positionKey = `${item['Position Room']}-${item['Position']}`;
                    const posInfo = positionMap.get(positionKey);
                    const value = column === 'type' ? posInfo?.type : posInfo?.status;
                    return values.includes(value);
                } else if (column === 'power_kva') {
                    const positionKey = `${item['Position Room']}-${item['Position']}`;
                    const posInfo = positionMap.get(positionKey);
                    return values.some(v => parseFloat(v) === posInfo?.power_kva);
                } else if (column === 'routingInfo.transformer') {
                    const routingValue = item.routingInfo?.transformer;
                    return values.some(v => String(routingValue || '').trim() === String(v).trim());
                } else if (column === 'routingInfo.utility') {
                    const routingValue = item.routingInfo?.utility;
                    return values.some(v => String(routingValue || '').trim() === String(v).trim());
                } else {
                    const itemValue = String(item[column] || '').trim();
                    return values.some(v => String(v).trim() === itemValue);
                }
            };

            // 应用筛选器
            const activeFilterEntries = Object.entries(filters).filter(([col, vals]) => vals && vals.length > 0);

            if (activeFilterEntries.length > 0) {
                if (filterLogic === 'and') {
                    // AND 逻辑：必须满足所有筛选条件
                    filteredData = EXCEL_DATA.filter(item => {
                        return activeFilterEntries.every(([column, values]) => {
                            return checkItemMatchesFilter(item, column, values);
                        });
                    });
                } else {
                    // OR 逻辑：满足任一筛选条件即可
                    filteredData = EXCEL_DATA.filter(item => {
                        return activeFilterEntries.some(([column, values]) => {
                            return checkItemMatchesFilter(item, column, values);
                        });
                    });
                }
            }

            // 创建受影响的 circuit 集合
            const affectedCircuits = new Set(
                Object.keys(filters).length === 0 ?
                EXCEL_DATA.map(row => row['Circuit Name']) :
                filteredData.map(row => row['Circuit Name'])
            );

            // 创建要显示的位置集合
            const positionsToShow = new Set();
            const powerRelatedFilters = ['PDU Name', 'UPS Group', 'USB', 'Power Feed', 'routingInfo.transformer', 'routingInfo.utility', 'Circuit Name', 'Circuit Number'];

            // 从 filteredData 中提取位置
            filteredData.forEach(row => {
                positionsToShow.add(`${row['Position Room']}-${row['Position']}`);
            });

            // 检查是否只有非电力相关的筛选条件
            const hasOnlyNonPowerFilters = activeFilterEntries.length === 0 ||
                activeFilterEntries.every(([col]) => !powerRelatedFilters.includes(col));

            // 处理没有电力数据但需要显示的位置
            if (hasOnlyNonPowerFilters && activeFilterEntries.length > 0) {
                // 检查单个位置是否匹配筛选条件
                const checkPositionMatchesFilter = (posInfo, column, values) => {
                    if (!values || values.length === 0) return true;

                    if (column === 'type') {
                        const valueToCheck = (posInfo?.type || 'unknown').toUpperCase();
                        return values.includes(valueToCheck);
                    } else if (column === 'status') {
                        const valueToCheck = posInfo?.status || 'unknown';
                        return values.includes(valueToCheck);
                    } else if (column === 'power_kva') {
                        return values.some(v => parseFloat(v) === posInfo?.power_kva);
                    } else if (column === 'Position Room') {
                        return values.includes(posInfo.room_name);
                    } else if (column === 'Position') {
                        return values.includes(posInfo.name);
                    }
                    return true; // 其他字段不适用于位置级别筛选
                };

                positionMap.forEach((posInfo, positionKey) => {
                    if (positionsToShow.has(positionKey)) return;

                    let shouldShow = false;

                    // 只检查非电力相关的筛选条件
                    const nonPowerFilters = activeFilterEntries.filter(([col]) => !powerRelatedFilters.includes(col));

                    if (nonPowerFilters.length > 0) {
                        if (filterLogic === 'and') {
                            shouldShow = nonPowerFilters.every(([column, values]) => {
                                return checkPositionMatchesFilter(posInfo, column, values);
                            });
                        } else {
                            shouldShow = nonPowerFilters.some(([column, values]) => {
                                return checkPositionMatchesFilter(posInfo, column, values);
                            });
                        }
                    }

                    if (shouldShow) {
                        positionsToShow.add(positionKey);
                    }
                });
            }

            // 构建 positions 对象
            const positions = {};
            Array.from(positionMap.entries()).forEach(([positionKey, posInfo]) => {
                positions[positionKey] = {
                    site: getPositionSite(EXCEL_DATA), room: posInfo.room_name, position: posInfo.name,
                    status: posInfo.status || 'unknown', type: (posInfo.type || 'unknown').toUpperCase(),
                    power_kva: posInfo.power_kva, power_redundancy: posInfo.power_redundancy,
                    powerChains: [], affectedPowerChains: []
                };
            });

            EXCEL_DATA.forEach(row => {
                const positionKey = `${row['Position Room']}-${row['Position']}`;
                if (positions[positionKey]) {
                    const powerChain = {
                        circuit: { name: row['Circuit Name'] || 'N/A', number: row['Circuit Number'] || 'N/A' },
                        pdu: { name: row['PDU Name'] || 'N/A', type: row['PDU Type'] || 'N/A' },
                        upsGroup: row['UPS Group'] || 'N/A', usb: row['USB'] || 'N/A',
                        powerFeed: row['Power Feed'] || 'N/A',
                        routingInfo: row.routingInfo || { transformer: 'N/A', utility: 'N/A' }
                    };
                    if (affectedCircuits.has(row['Circuit Name'])) {
                        positions[positionKey].affectedPowerChains.push(powerChain);
                    }
                    positions[positionKey].powerChains.push(powerChain);
                }
            });

            Object.keys(positions).forEach(positionKey => {
                if (positions[positionKey].powerChains.length === 0) {
                    positions[positionKey].powerChains.push({
                        circuit: { name: 'N/A', number: 'N/A' }, pdu: { name: 'N/A', type: 'N/A' },
                        upsGroup: 'N/A', usb: 'N/A', powerFeed: 'N/A', routingInfo: { transformer: 'N/A', utility: 'N/A' }
                    });
                }
            });
            window.positions = positions;

            // 初始化统计
            const rackTypes = [...new Set(Object.values(positions).map(p => p.type.toUpperCase()))];
            rackTypes.forEach(type => {
                stats.detailedStats[type] = { 'Lost Primary': 0, 'Lost Secondary': 0, 'Partial Power Loss': 0, 'Complete Power Loss': 0, 'Total': 0, euclidCount: { 'Lost Primary': 0, 'Lost Secondary': 0, 'Partial Power Loss': 0, 'Complete Power Loss': 0 } };
            });

            window.filteredPositions = {};
            const affectedPositionKeys = new Set(filteredData.map(row => `${row['Position Room']}-${row['Position']}`));
            affectedPositionKeys.forEach(positionKey => {
                if (positions[positionKey]) {
                    window.filteredPositions[positionKey] = { ...positions[positionKey], powerChains: [...positions[positionKey].powerChains], affectedPowerChains: [] };
                }
            });

            filteredData.forEach(row => {
                const positionKey = `${row['Position Room']}-${row['Position']}`;
                if (window.filteredPositions[positionKey] && affectedCircuits.has(row['Circuit Name'])) {
                    const affectedChain = window.filteredPositions[positionKey].powerChains.find(chain => chain.circuit.name === row['Circuit Name']);
                    if (affectedChain) window.filteredPositions[positionKey].affectedPowerChains.push(affectedChain);
                }
            });

            // Patch racks 统计
            stats.patchRacks = { total: 0, positions: [] };
            Array.from(positionMap.entries()).forEach(([positionKey, posInfo]) => {
                if (posInfo?.type?.toUpperCase() === 'PATCH') {
                    stats.patchRacks.total++;
                    stats.patchRacks.positions.push({ room: posInfo.room_name, position: posInfo.name });
                }
            });

            // 处理统计
            const processedPositions = new Set();
            Object.entries(window.filteredPositions).forEach(([positionKey, position]) => {
                if (processedPositions.has(positionKey)) return;
                processedPositions.add(positionKey);

                const posInfo = positionMap.get(positionKey);
                if (posInfo?.status === 'deployed' && posInfo?.type?.toUpperCase() !== 'PATCH') {
                    const type = (posInfo.type || 'unknown').toUpperCase();
                    const redundancy = posInfo.power_redundancy;
                    const isEuclid = posInfo?.is_brick === true;

                    if (!stats.detailedStats[type]) {
                        stats.detailedStats[type] = { 'Lost Primary': 0, 'Lost Secondary': 0, 'Partial Power Loss': 0, 'Complete Power Loss': 0, 'Total': 0, euclidCount: { 'Lost Primary': 0, 'Lost Secondary': 0, 'Partial Power Loss': 0, 'Complete Power Loss': 0 } };
                    }

                    stats.detailedStats[type]['Total']++;

                    const hasPowerChainData = position.powerChains.some(chain => chain.circuit.name !== 'N/A');
                    if (!hasPowerChainData) {
                        stats.detailedStats[type]['Complete Power Loss']++;
                        if (isEuclid) stats.detailedStats[type].euclidCount['Complete Power Loss']++;
                        return;
                    }

                    const expected = expectedPowerByPosition[positionKey];
                    if (!expected) return;

                    const remainingPrimary = position.powerChains.filter(chain => chain.powerFeed.toLowerCase() === 'primary' && !position.affectedPowerChains.some(affected => affected.circuit.name === chain.circuit.name)).length;
                    const remainingSecondary = position.powerChains.filter(chain => chain.powerFeed.toLowerCase() === 'secondary' && !position.affectedPowerChains.some(affected => affected.circuit.name === chain.circuit.name)).length;
                    const hasDualPower = expected.primary > 0 && expected.secondary > 0;

                    if (redundancy === '2N' || redundancy === 'N+C') {
                        if (!hasDualPower) {
                            if (remainingPrimary === 0 && expected.primary > 0) {
                                stats.detailedStats[type]['Complete Power Loss']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Complete Power Loss']++;
                            } else if (remainingPrimary < expected.primary) {
                                stats.detailedStats[type]['Lost Primary']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Lost Primary']++;
                            }
                        } else {
                            if (remainingPrimary === 0 && remainingSecondary === 0) {
                                stats.detailedStats[type]['Complete Power Loss']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Complete Power Loss']++;
                            } else if (remainingPrimary === 0 && remainingSecondary > 0) {
                                stats.detailedStats[type]['Lost Primary']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Lost Primary']++;
                            } else if (remainingSecondary === 0 && remainingPrimary > 0) {
                                stats.detailedStats[type]['Lost Secondary']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Lost Secondary']++;
                            } else if (remainingPrimary < expected.primary && remainingSecondary < expected.secondary && remainingPrimary > 0 && remainingSecondary > 0) {
                                stats.detailedStats[type]['Partial Power Loss']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Partial Power Loss']++;
                            }
                        }
                    } else {
                        if (!hasDualPower) {
                            if (remainingPrimary === 0 && expected.primary > 0) {
                                stats.detailedStats[type]['Complete Power Loss']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Complete Power Loss']++;
                            } else if (remainingPrimary < expected.primary) {
                                stats.detailedStats[type]['Partial Power Loss']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Partial Power Loss']++;
                            }
                        } else {
                            if (remainingPrimary === 0 && remainingSecondary === 0) {
                                stats.detailedStats[type]['Complete Power Loss']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Complete Power Loss']++;
                            } else if (remainingPrimary === 0 && remainingSecondary > 0) {
                                stats.detailedStats[type]['Lost Primary']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Lost Primary']++;
                            } else if (remainingSecondary === 0 && remainingPrimary > 0) {
                                stats.detailedStats[type]['Lost Secondary']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Lost Secondary']++;
                            } else if (remainingPrimary < expected.primary && remainingSecondary < expected.secondary && remainingPrimary > 0 && remainingSecondary > 0) {
                                stats.detailedStats[type]['Partial Power Loss']++;
                                if (isEuclid) stats.detailedStats[type].euclidCount['Partial Power Loss']++;
                            }
                        }
                    }
                }
            });

            // 过滤活跃的rack类型
            const activeRackTypes = rackTypes.filter(type => {
                const typeStats = stats.detailedStats[type];
                if (!typeStats) return false;
                const totalCount = ['Lost Primary', 'Lost Secondary', 'Partial Power Loss', 'Complete Power Loss'].reduce((sum, metric) => sum + (typeStats[metric] || 0), 0);
                return totalCount > 0;
            });

            // 收集下游机柜
            const uniqueDownstreamRacks = new Set();
            const downstreamRacksList = [];
            const affectedEuclidRacks = new Set();

            Object.entries(positions).forEach(([key, position]) => {
                const posInfo = positionMap.get(key);
                if (position.status === 'deployed' && posInfo?.is_brick && posInfo?.downstreamRacks) {
                    const isAffected = position.affectedPowerChains.length > 0;
                    if (isAffected) affectedEuclidRacks.add(key);
                }
            });

            affectedEuclidRacks.forEach(rackKey => {
                const posInfo = positionMap.get(rackKey);
                if (posInfo?.downstreamRacks && Array.isArray(posInfo.downstreamRacks)) {
                    posInfo.downstreamRacks.forEach(downstream => {
                        const downstreamKey = `${downstream.room}-${downstream.position}`;
                        const downstreamPosInfo = positionMap.get(downstreamKey);
                        if (downstreamPosInfo && downstreamPosInfo.status === 'deployed' && !uniqueDownstreamRacks.has(downstreamKey)) {
                            uniqueDownstreamRacks.add(downstreamKey);
                            downstreamRacksList.push({ room: downstream.room, position: downstream.position, rack_type: downstream.rack_type, fabric: downstream.fabric });
                        }
                    });
                }
            });

            const downstreamStats = { totalUniqueDownstream: uniqueDownstreamRacks.size, racksList: downstreamRacksList };

            // getPositionsForMetric 函数
            function getPositionsForMetric(positionsObj, type, metric) {
                const result = [];
                Object.entries(window.filteredPositions).forEach(([key, position]) => {
                    const posInfo = positionMap.get(key);
                    if (!posInfo || posInfo.type?.toUpperCase() !== type || posInfo.status !== 'deployed') return;

                    const expected = expectedPowerByPosition[key];
                    if (!expected) return;

                    const remainingPrimary = position.powerChains.filter(chain => chain.powerFeed.toLowerCase() === 'primary' && !position.affectedPowerChains.some(affected => affected.circuit.name === chain.circuit.name)).length;
                    const remainingSecondary = position.powerChains.filter(chain => chain.powerFeed.toLowerCase() === 'secondary' && !position.affectedPowerChains.some(affected => affected.circuit.name === chain.circuit.name)).length;
                    const hasDualPower = expected.primary > 0 && expected.secondary > 0;
                    const redundancy = posInfo.power_redundancy;

                    if (redundancy === '2N' || redundancy === 'N+C') {
                        if (!hasDualPower) {
                            if (metric === 'Complete Power Loss' && remainingPrimary === 0 && expected.primary > 0) result.push(position.position);
                            else if (metric === 'Lost Primary' && remainingPrimary < expected.primary && remainingPrimary > 0) result.push(position.position);
                        } else {
                            if (metric === 'Complete Power Loss' && remainingPrimary === 0 && remainingSecondary === 0) result.push(position.position);
                            else if (metric === 'Lost Primary' && remainingPrimary === 0 && remainingSecondary > 0) result.push(position.position);
                            else if (metric === 'Lost Secondary' && remainingSecondary === 0 && remainingPrimary > 0) result.push(position.position);
                            else if (metric === 'Partial Power Loss' && remainingPrimary < expected.primary && remainingSecondary < expected.secondary && remainingPrimary > 0 && remainingSecondary > 0) result.push(position.position);
                        }
                    } else {
                        if (!hasDualPower) {
                            if (metric === 'Complete Power Loss' && remainingPrimary === 0 && remainingSecondary === 0 && (expected.primary > 0 || expected.secondary > 0)) result.push(position.position);
                            else if (metric === 'Partial Power Loss' && remainingPrimary < expected.primary) result.push(position.position);
                        } else {
                            if (metric === 'Complete Power Loss' && remainingPrimary === 0 && remainingSecondary === 0) result.push(position.position);
                            else if (metric === 'Lost Primary' && remainingPrimary === 0 && remainingSecondary > 0) result.push(position.position);
                            else if (metric === 'Lost Secondary' && remainingSecondary === 0 && remainingPrimary > 0) result.push(position.position);
                            else if (metric === 'Partial Power Loss' && remainingPrimary < expected.primary && remainingSecondary < expected.secondary && remainingPrimary > 0 && remainingSecondary > 0) result.push(position.position);
                        }
                    }
                });
                return result;
            }

            // generateStatsCell 函数
            function generateStatsCell(type, metric, displayValue, positions) {
                if (displayValue === 0 || metric === 'Total') return `<td class="stats-cell">${displayValue}</td>`;

                const euclidCount = positions.filter(position => {
                    const matchingKey = Object.keys(window.filteredPositions).find(key => {
                        const pos = window.filteredPositions[key];
                        return pos.position === position && positionMap.get(key)?.type?.toUpperCase() === type;
                    });
                    if (!matchingKey) return false;
                    return positionMap.get(matchingKey)?.is_brick === true;
                }).length;

                const displayText = euclidCount > 0 ? `${displayValue} (${euclidCount})` : displayValue;
                return `<td class="stats-cell clickable" data-type="${type}" data-metric="${metric}" data-positions='${JSON.stringify(positions)}'>${displayText}</td>`;
            }

            // 生成统计表格HTML
            const currentLogic = window.filterLogic || 'and';
            const statsHtml = `
            <div class="stats-container">
                <div class="stats-header-row">
                    <div class="filter-logic-inline">
                        <span class="logic-label">Logic:</span>
                        <div class="logic-toggle">
                            <button class="logic-btn-sm ${currentLogic === 'and' ? 'active' : ''}" data-logic="and">AND</button>
                            <button class="logic-btn-sm ${currentLogic === 'or' ? 'active' : ''}" data-logic="or">OR</button>
                        </div>
                    </div>
                </div>
                <div class="stats-tables-wrapper">
                    <div class="stats-details">
                        <table class="stats-table">
                            <thead>
                                <tr>
                                    <th>Power Status</th>
                                    ${activeRackTypes.filter(type => type !== 'PATCH').map(type => `<th>${type === 'NETWORK' ? 'NETWORK(Euclid)' : type}</th>`).join('')}
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${['Lost Primary', 'Lost Secondary', 'Partial Power Loss', 'Complete Power Loss'].map(metric => {
                                    const rowValues = activeRackTypes.filter(type => type !== 'PATCH').map(type => {
                                        const total = stats.detailedStats[type][metric];
                                        const positionsArray = getPositionsForMetric(window.positions, type, metric);
                                        return generateStatsCell(type, metric, total, positionsArray);
                                    });
                                    const rowTotal = activeRackTypes.filter(type => type !== 'PATCH').reduce((sum, type) => sum + (stats.detailedStats[type][metric] || 0), 0);
                                    return `<tr><td>${metric}</td>${rowValues.join('')}<td class="stats-cell">${rowTotal}</td></tr>`;
                                }).join('')}
                                <tr class="total-row">
                                    <td>Total</td>
                                    ${activeRackTypes.filter(type => type !== 'PATCH').map(type => {
                                        const totalCount = ['Lost Primary', 'Lost Secondary', 'Partial Power Loss', 'Complete Power Loss'].reduce((sum, metric) => sum + (stats.detailedStats[type][metric] || 0), 0);
                                        return generateStatsCell(type, 'Total', totalCount, []);
                                    }).join('')}
                                    <td class="stats-cell">${activeRackTypes.filter(type => type !== 'PATCH').reduce((sum, type) => sum + ['Lost Primary', 'Lost Secondary', 'Partial Power Loss', 'Complete Power Loss'].reduce((subSum, metric) => subSum + (stats.detailedStats[type][metric] || 0), 0), 0)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="side-stats">
                        ${downstreamStats.totalUniqueDownstream > 0 ? `
                            <div class="downstream-stats">
                                <table class="stats-table">
                                    <thead><tr><th>Network-connected rack</th></tr></thead>
                                    <tbody><tr><td class="stats-cell clickable" data-positions='${JSON.stringify(downstreamRacksList)}'>${downstreamStats.totalUniqueDownstream}</td></tr></tbody>
                                </table>
                            </div>` : ''}
                        ${stats.patchRacks.total > 0 ? `
                            <div class="patch-stats">
                                <table class="stats-table">
                                    <thead><tr><th>Patch rack</th></tr></thead>
                                    <tbody><tr><td class="stats-cell clickable" data-patch-positions='${JSON.stringify(stats.patchRacks.positions)}'>${stats.patchRacks.total}</td></tr></tbody>
                                </table>
                            </div>` : ''}
                    </div>
                </div>
                <div class="export-button-container">
                    <button id="exportStatsBtn" class="export-button"><span class="export-icon">📋</span> Copy</button>
                </div>
            </div>`;

            const filteredPositionsCount = Object.entries(positions).filter(([key]) => positionsToShow.has(key)).length;
            const positionsCountHtml = `<div class="positions-count-container"><div class="positions-count"><span class="count-label">Total Positions:</span><span class="count-value">${filteredPositionsCount}</span></div></div>`;

            // 生成位置HTML
            const positionsHtml = Object.entries(positions)
                .filter(([key]) => positionsToShow.has(key))
                .sort(([keyA], [keyB]) => String(keyA).localeCompare(String(keyB), undefined, {numeric: true}))
                .map(([key, position]) => {
                    const positionInfo = positionMap.get(key);
                    if (!positionInfo) return '';

                    const isEuclid = positionInfo.is_brick === true;
                    const euclidDownstreamData = isEuclid && positionInfo.downstreamRacks ?
                        JSON.stringify({ hostname: positionInfo.hostname || 'Unknown', room: positionInfo.room_name, position: positionInfo.name, downstreamRacks: positionInfo.downstreamRacks }).replace(/'/g, '&#39;').replace(/"/g, '&quot;') : '';

                    return `
                    <div class="topo-item ${isEuclid ? 'euclid-brick' : ''}">
                        <div class="topo-item-header">
                            <div class="position-info">
                                <span class="status-indicator status-${positionInfo.status.toLowerCase() || 'unknown'}"></span>
                                <span class="position-id">${positionInfo.room_name} ${positionInfo.name}</span>
                                ${positionInfo.status === 'deployed' ? `<span class="rack-type">${positionInfo.type || 'Unknown'}</span>` : ''}
                                ${positionInfo.power_redundancy ? `<span class="power-redundancy">(${positionInfo.power_redundancy})</span>` : ''}
                                ${isEuclid ? `<span class="euclid-tag clickable" data-euclid-info="${euclidDownstreamData}" title="Click to view downstream racks">Euclid (${positionInfo.downstreamRacks?.length || 0})</span>` : ''}
                            </div>
                            <div class="position-tags">
                                <span class="filter-tag status-tag-${positionInfo.status.toLowerCase() || 'unknown'}">${positionInfo.status || 'Unknown'}</span>
                                <span class="filter-tag">Circuits: ${position.powerChains[0]?.circuit?.name === 'N/A' ? 0 : position.powerChains.length}</span>
                                ${positionInfo.power_kva ? `<span class="filter-tag">Power: ${positionInfo.power_kva} kVA</span>` : ''}
                            </div>
                        </div>
                        <div class="topo-item-content">
                            ${position.powerChains.map(chain => `
                                <div class="power-chain ${chain.powerFeed === 'N/A' ? 'power-chain-na' : `power-chain-${chain.powerFeed.toLowerCase()}`}">
                                    <div class="chain-header">${chain.powerFeed === 'N/A' ? 'No Power Chain Data' : `Power Feed: ${chain.powerFeed}`}</div>
                                    <div class="chain-path">
                                        <div class="chain-item"><div class="chain-label">Circuit</div><div class="chain-value">${chain.circuit.name}</div></div>
                                        <div class="chain-arrow">→</div>
                                        <div class="chain-item"><div class="chain-label">PDU</div><div class="chain-value">${chain.pdu.name}</div></div>
                                        <div class="chain-arrow">→</div>
                                        <div class="chain-item"><div class="chain-label">UPS</div><div class="chain-value">${chain.upsGroup}</div></div>
                                        <div class="chain-arrow">→</div>
                                        <div class="chain-item"><div class="chain-label">USB</div><div class="chain-value">${chain.usb}</div></div>
                                        <div class="chain-arrow">→</div>
                                        <div class="chain-item"><div class="chain-label">Transformer</div><div class="chain-value">${chain.routingInfo?.transformer || 'N/A'}</div></div>
                                        <div class="chain-arrow">→</div>
                                        <div class="chain-item"><div class="chain-label">Utility</div><div class="chain-value">${chain.routingInfo?.utility || 'N/A'}</div></div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>`;
                }).join('');

            // 渲染内容
            let contentContainer = topoView.querySelector('.content-container');
            if (!contentContainer) {
                contentContainer = document.createElement('div');
                contentContainer.className = 'content-container';
                topoView.appendChild(contentContainer);
            }

            contentContainer.innerHTML = `
                <h3 class="section-title summary-title">Summary Table</h3>
                ${statsHtml}
                ${positionsCountHtml}
                <h3 class="section-title detail-title">Detail Info</h3>
                <div class="positions-container">${positionsHtml}</div>
            `;

            // 初始化筛选器
            if (!window.filtersInitialized) {
                initializeFilters(filtersContainer, stats);
                window.filtersInitialized = true;
            }

            // 添加事件
            document.querySelectorAll('.topo-item-header').forEach(header => {
                header.addEventListener('click', () => header.nextElementSibling.classList.toggle('active'));
            });

            setupModalEvents();
            setupExportButton();
            setupLogicToggle();

        } catch (error) {
            console.error('Error updating display:', error);
            topoView.innerHTML = `<div class="error-message">Failed to update display: ${error.message}</div>`;
        }
    }

    function setupLogicToggle() {
        const logicBtns = document.querySelectorAll('.logic-btn-sm');
        logicBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                // 更新按钮状态
                logicBtns.forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                // 更新全局逻辑
                window.filterLogic = this.dataset.logic;

                // 收集当前筛选条件并重新计算
                const activeFilters = {};
                $('.filter-select').each(function() {
                    const column = $(this).data('column');
                    const values = $(this).val() || [];
                    if (values.length > 0) {
                        activeFilters[column] = values.map(value => String(value).trim());
                    }
                });

                // 重新更新显示
                updateDisplay(activeFilters);
            });
        });
    }

    function setupExportButton() {
        const exportBtn = document.getElementById('exportStatsBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                const activeRackTypes = Object.keys(window.positions ?
                    [...new Set(Object.values(window.positions).map(p => p.type.toUpperCase()))] : []);
                let markdown = `| Power Status | ${activeRackTypes.join(' | ')} | Total |\n`;
                markdown += `|${'-'.repeat(13)}|${activeRackTypes.map(() => '-'.repeat(10)).join('|')}|${'-'.repeat(10)}|\n`;

                navigator.clipboard.writeText(markdown).then(() => {
                    exportBtn.innerHTML = '<span class="export-icon">✓</span> Copied!';
                    exportBtn.classList.add('copied');
                    setTimeout(() => {
                        exportBtn.innerHTML = '<span class="export-icon">📋</span> Copy';
                        exportBtn.classList.remove('copied');
                    }, 3000);
                });
            });
        }
    }

    // ==================== Part 4b 开始 ====================

    function setupModalEvents() {
        const modal = document.querySelector('.position-modal');
        const backdrop = document.querySelector('.modal-backdrop');
        if (!modal || !backdrop) return;

        const closeModal = () => {
            modal.style.display = 'none';
            backdrop.style.display = 'none';
        };

        const resetModalContent = () => {
            modal.querySelector('.modal-content').innerHTML = '<div class="position-list"></div>';
        };

        backdrop.addEventListener('click', closeModal);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'block') closeModal();
        });

        const showEuclidModal = (euclidInfo) => {
            const downstreamRacks = euclidInfo.downstreamRacks || [];
            const copyText = [
                `Euclid Brick: ${euclidInfo.hostname}`,
                `Position: ${euclidInfo.room} ${euclidInfo.position}`,
                `Downstream Racks (${downstreamRacks.length}):`,
                '',
                ...downstreamRacks
                    .sort((a, b) => String(a.position).localeCompare(String(b.position), undefined, {numeric: true}))
                    .map(rack => `${rack.room} ${rack.position} | ${rack.rack_type || 'N/A'} | ${rack.fabric || 'N/A'}`)
            ].join('\n');

            modal.querySelector('.modal-header').innerHTML = `
                <div class="modal-title"><span class="euclid-modal-icon">🔷</span> Euclid Brick: ${euclidInfo.hostname}</div>
                <div class="modal-actions">
                    <button class="copy-positions-button" data-copy-text="${encodeURIComponent(copyText)}"><span class="export-icon">📋</span> Copy</button>
                    <div class="modal-close">&times;</div>
                </div>`;

            modal.querySelector('.modal-content').innerHTML = `
                <div class="euclid-modal-info">
                    <div class="euclid-info-row"><span class="euclid-info-label">Brick Position:</span><span class="euclid-info-value">${euclidInfo.room} ${euclidInfo.position}</span></div>
                    <div class="euclid-info-row"><span class="euclid-info-label">Downstream Racks:</span><span class="euclid-info-value">${downstreamRacks.length}</span></div>
                </div>
                <div class="euclid-downstream-table-container">
                    <table class="euclid-downstream-table">
                        <thead><tr><th>Position</th><th>Rack Type</th><th>Fabric</th></tr></thead>
                        <tbody>${downstreamRacks.length > 0 ?
                            downstreamRacks
                                .sort((a, b) => String(a.position).localeCompare(String(b.position), undefined, {numeric: true}))
                                .map(rack => `<tr><td>${rack.room} ${rack.position}</td><td>${rack.rack_type || 'N/A'}</td><td>${rack.fabric || 'N/A'}</td></tr>`)
                                .join('') :
                            '<tr><td colspan="3" class="no-data">No downstream racks found</td></tr>'
                        }</tbody>
                    </table>
                </div>`;

            modal.style.display = 'block';
            backdrop.style.display = 'block';
        };

        // 模态框内部点击事件
        modal.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-close')) {
                closeModal();
                return;
            }

            const copyBtn = e.target.closest('.copy-positions-button');
            if (copyBtn) {
                const copyText = decodeURIComponent(copyBtn.dataset.copyText || '');
                if (copyText) {
                    navigator.clipboard.writeText(copyText).then(() => {
                        const originalHTML = copyBtn.innerHTML;
                        copyBtn.innerHTML = '<span class="export-icon">✓</span> Copied!';
                        copyBtn.classList.add('copied');
                        setTimeout(() => {
                            copyBtn.innerHTML = originalHTML;
                            copyBtn.classList.remove('copied');
                        }, 3000);
                    });
                }
                return;
            }

            const euclidTag = e.target.closest('.euclid-indicator.clickable');
            if (euclidTag && euclidTag.dataset.euclidInfo) {
                try {
                    showEuclidModal(JSON.parse(decodeURIComponent(euclidTag.dataset.euclidInfo)));
                } catch (error) {
                    console.error('Error parsing Euclid info:', error);
                }
            }
        });

        // 统计单元格点击事件
        document.querySelectorAll('.stats-cell.clickable').forEach(cell => {
            cell.addEventListener('click', () => {
                try {
                    resetModalContent();

                    if (cell.dataset.type && cell.dataset.metric) {
                        const type = cell.dataset.type;
                        const metric = cell.dataset.metric;
                        const positions = JSON.parse(cell.dataset.positions);
                        const positionsText = positions
                            .sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true}))
                            .join('\n');

                        modal.querySelector('.modal-header').innerHTML = `
                            <div class="modal-title">${type} - ${metric} (${positions.length} positions)</div>
                            <div class="modal-actions">
                                <button class="copy-positions-button" data-copy-text="${encodeURIComponent(positionsText)}"><span class="export-icon">📋</span> Copy</button>
                                <div class="modal-close">&times;</div>
                            </div>`;

                        modal.querySelector('.position-list').innerHTML = positions
                            .sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true}))
                            .map(position => {
                                const matchingPosition = Object.entries(window.positions).find(([key, pos]) =>
                                    pos.position === position && pos.type.toUpperCase() === type
                                );
                                if (!matchingPosition) return '';

                                const [positionKey] = matchingPosition;
                                const posInfo = positionMap.get(positionKey);
                                const isEuclid = posInfo?.is_brick === true;

                                let euclidDataAttr = '';
                                if (isEuclid && posInfo.downstreamRacks) {
                                    euclidDataAttr = `data-euclid-info="${encodeURIComponent(JSON.stringify({
                                        hostname: posInfo.hostname || 'Unknown',
                                        room: posInfo.room_name,
                                        position: posInfo.name,
                                        downstreamRacks: posInfo.downstreamRacks
                                    }))}"`;
                                }

                                return `
                                    <div class="position-item ${isEuclid ? 'euclid-position' : ''}">
                                        <span class="position-name">${position}</span>
                                        ${isEuclid ? `<span class="euclid-indicator clickable" ${euclidDataAttr} title="Click to view downstream racks">Euclid (${posInfo.downstreamRacks?.length || 0})</span>` : ''}
                                    </div>`;
                            })
                            .filter(html => html)
                            .join('');

                        modal.style.display = 'block';
                        backdrop.style.display = 'block';

                    } else if (cell.dataset.patchPositions) {
                        const positions = JSON.parse(cell.dataset.patchPositions);
                        const positionsText = positions
                            .sort((a, b) => `${a.room} ${a.position}`.localeCompare(`${b.room} ${b.position}`, undefined, {numeric: true}))
                            .map(pos => `${pos.room} ${pos.position}`)
                            .join('\n');

                        modal.querySelector('.modal-header').innerHTML = `
                            <div class="modal-title">Patch racks (${positions.length} positions)</div>
                            <div class="modal-actions">
                                <button class="copy-positions-button" data-copy-text="${encodeURIComponent(positionsText)}"><span class="export-icon">📋</span> Copy</button>
                                <div class="modal-close">&times;</div>
                            </div>`;

                        modal.querySelector('.position-list').innerHTML = positions
                            .sort((a, b) => `${a.room} ${a.position}`.localeCompare(`${b.room} ${b.position}`, undefined, {numeric: true}))
                            .map(position => `<div class="position-item"><span class="position-name">${position.room} ${position.position}</span></div>`)
                            .join('');

                        modal.style.display = 'block';
                        backdrop.style.display = 'block';

                    } else if (cell.dataset.positions) {
                        const positions = JSON.parse(cell.dataset.positions);
                        if (!positions.length) return;

                        const positionsText = positions
                            .sort((a, b) => String(a.position).localeCompare(String(b.position), undefined, {numeric: true}))
                            .map(pos => `${pos.room} ${pos.position}`)
                            .join('\n');

                        modal.querySelector('.modal-header').innerHTML = `
                            <div class="modal-title">Network-connected racks (${positions.length} positions)</div>
                            <div class="modal-actions">
                                <button class="copy-positions-button" data-copy-text="${encodeURIComponent(positionsText)}"><span class="export-icon">📋</span> Copy</button>
                                <div class="modal-close">&times;</div>
                            </div>`;

                        modal.querySelector('.position-list').innerHTML = positions
                            .sort((a, b) => String(a.position).localeCompare(String(b.position), undefined, {numeric: true}))
                            .map(position => `
                                <div class="position-item">
                                    <span class="position-name">${position.room} ${position.position}</span>
                                    ${position.rack_type ? `<span class="rack-type-tag">${position.rack_type}</span>` : ''}
                                </div>`)
                            .join('');

                        modal.style.display = 'block';
                        backdrop.style.display = 'block';
                    }
                } catch (error) {
                    console.error('Error handling cell click:', error);
                }
            });
        });

        // Euclid 标签点击事件
        document.querySelectorAll('.euclid-tag.clickable').forEach(tag => {
            tag.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    const euclidInfo = JSON.parse(tag.dataset.euclidInfo.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
                    if (euclidInfo) showEuclidModal(euclidInfo);
                } catch (error) {
                    console.error('Error handling Euclid tag click:', error);
                }
            });
        });
    }

    // 初始化函数
    async function init() {
        const maxRetries = 3;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                await loadExternalResources();

                if (!window.jQuery || !window.jQuery.fn.select2) {
                    throw new Error('Required dependencies not loaded');
                }

                const container = setupInterface();
                document.getElementById('xwikicontent').appendChild(container);

                const loadingIndicator = container.querySelector('.loading-indicator');
                if (loadingIndicator) {
                    loadingIndicator.style.display = 'none';
                }

                break;
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
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }
        }
    }

    // ==================== 样式定义 ====================
    GM_addStyle(`
        /* 站点选择区域 */
        .site-selection-section { padding: 20px; margin-bottom: 20px; background: #f8f9fa; border-radius: 6px; text-align: center; }
        .site-selection-section h2 { margin-bottom: 15px; color: #1976d2; }
        .custom-dropdown { position: relative; width: 300px; margin: 0 auto; }
        .selected-option { padding: 10px 15px; border: 1px solid #ddd; border-radius: 4px; background-color: white; cursor: pointer; user-select: none; }
        .selected-option:hover { background-color: #f8f9fa; }
        .selected-option:focus { outline: none; box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2); }
        .dropdown-options { display: none; position: absolute; top: 100%; left: 0; right: 0; max-height: 200px; overflow-y: auto; background-color: white; border: 1px solid #ddd; border-top: none; border-radius: 0 0 4px 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); z-index: 1000; list-style: none; margin: 0; padding: 0; }
        .dropdown-options li { padding: 10px 15px; cursor: pointer; }
        .dropdown-options li:hover { background-color: #f8f9fa; }

        /* 主容器 */
        .topo-container { width: 100%; background: white; padding: 20px; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin: 20px 0; display: flex; flex-direction: column; }
        .loading-indicator { margin-top: 15px; color: #1976d2; font-weight: bold; padding: 15px; text-align: center; background: #f8f9fa; border-radius: 4px; }
        .error-message { color: #f44336; padding: 10px; margin: 10px 0; background: #fee; border-radius: 4px; border: 1px solid #fdd; }

        /* 筛选器容器 */
        .filters-container { display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; gap: 15px; padding: 15px; background: #f5f5f5; border-radius: 6px; margin-bottom: 15px; overflow-x: auto !important; overflow-y: hidden !important; align-items: flex-start; }
        .filter-section { flex: 0 0 auto; min-width: 200px; width: 200px !important; }
        .filter-section label { white-space: nowrap; display: block; margin-bottom: 5px; font-weight: 600; font-size: 14px; color: #16191f; }
        .select2-container { min-width: 200px !important; width: 200px !important; }
        .select2-container--default .select2-selection--multiple .select2-selection__choice:not(:first-child) { display: none; }
        .select2-dropdown { z-index: 9999 !important; }

        /* Tips 容器 */
        .tips-container { margin: 15px 0; background: #f8f9fa; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
        .tips-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; background: linear-gradient(135deg, #4A53D3 0%, #4AD3CA 100%); color: white; cursor: pointer; user-select: none; }
        .tips-title { display: flex; align-items: center; font-weight: 600; font-size: 15px; }
        .tips-icon { font-size: 20px; margin-right: 10px; }
        .tips-toggle { font-size: 14px; transition: transform 0.3s ease; }
        .tips-container.collapsed .tips-toggle { transform: rotate(-90deg); }
        .tips-content { padding: 15px 20px; background: white; max-height: 500px; overflow: hidden; transition: max-height 0.3s ease, padding 0.3s ease; }
        .tips-container.collapsed .tips-content { max-height: 0; padding: 0 20px; }
        .tips-list { margin: 0; padding-left: 20px; list-style: none; }
        .tips-list li { margin-bottom: 10px; line-height: 1.6; color: #333; position: relative; padding-left: 15px; }
        .tips-list li:before { content: "▸"; position: absolute; left: 0; color: #667eea; font-weight: bold; }
        .tips-list li strong { color: #667eea; }

        /* 进度条 */
        .progress-container { margin: 20px 0; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center; }
        .progress-bar { width: 100%; height: 20px; background: #e9ecef; border-radius: 10px; overflow: hidden; margin-bottom: 10px; }
        .progress-fill { width: 0%; height: 100%; background: #2196F3; transition: width 0.3s ease; background-image: linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent); background-size: 1rem 1rem; animation: progress-bar-stripes 1s linear infinite; }
        @keyframes progress-bar-stripes { 0% { background-position: 1rem 0; } 100% { background-position: 0 0; } }
        .progress-text { font-size: 14px; color: #666; margin-bottom: 5px; }
        .progress-step { font-size: 12px; color: #999; }

        /* 统计表格 - 修复对齐问题 */
        .stats-container { padding: 15px; margin: 10px 0; background: #e3f2fd; border-radius: 6px; font-size: 0.9em; }
        .stats-tables-wrapper { display: flex; gap: 20px; align-items: flex-start; }
        .stats-details { flex: 1; overflow-x: auto; }
        .stats-table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); table-layout: fixed; }
        .stats-table th, .stats-table td { padding: 12px; text-align: center; border: 1px solid #e0e0e0; }
        .stats-table th { background: #f5f5f5; font-weight: bold; color: #333; font-size: 14px; white-space: nowrap; }
        .stats-table th:first-child, .stats-table td:first-child { width: 180px; text-align: left; font-weight: bold; background: #f5f5f5; }
        .stats-table th:last-child, .stats-table td:last-child { background-color: #f5f5f5; font-weight: bold; border-left: 2px solid #e0e0e0; }
        .stats-cell { font-family: 'Arial', sans-serif; font-weight: bold; color: #000000; font-size: 14px; text-align: center; }
        .stats-cell.clickable { cursor: pointer; transition: background-color 0.2s; }
        .stats-cell.clickable:hover { background-color: #f5f5f5; }
        .total-row { background-color: #f5f5f5 !important; }
        .total-row td { font-weight: bold; border-top: 2px solid #90caf9; }
        .total-row td:last-child { color: #1976d2; }

        /* 右侧统计表格 - 修复对齐 */
        .side-stats { display: flex; flex-direction: column; gap: 15px; align-self: flex-start; }
        .downstream-stats, .patch-stats { width: 200px; }
        .downstream-stats .stats-table, .patch-stats .stats-table { width: 100%; margin: 0; table-layout: fixed; }
        .downstream-stats .stats-table th, .patch-stats .stats-table th { text-align: center; padding: 12px; background: #f5f5f5; font-weight: bold; color: #333; font-size: 14px; white-space: nowrap; border: 1px solid #e0e0e0; }
        .downstream-stats .stats-cell, .patch-stats .stats-cell { text-align: center !important; padding: 12px; font-weight: bold; color: #000000; font-size: 14px; border: 1px solid #e0e0e0; }

        /* 位置计数 */
        .positions-count-container { margin: 15px 0; }
        .positions-count { display: flex; align-items: center; gap: 10px; }
        .count-label { font-weight: bold; color: #1976d2; }
        .count-value { font-size: 1em; font-weight: bold; color: #333; padding: 2px 10px; }

        /* 区域标题 */
        .section-title { font-size: 20px; font-weight: 600; color: #333; margin: 25px 0 15px 0; padding-bottom: 10px; border-bottom: 3px solid #667eea; position: relative; }
        .section-title:before { content: ''; position: absolute; bottom: -3px; left: 0; width: 60px; height: 3px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .summary-title { margin-top: 10px; }
        .detail-title { margin-top: 30px; }

        /* 位置项 */
        .topo-view { flex: 1; overflow-y: auto; padding: 15px; background: #fff; border: 1px solid #eee; border-radius: 6px; }
        .topo-item { background: #fff; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .topo-item-header { padding: 12px 15px; background: #f8f9fa; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; font-weight: bold; border-radius: 6px 6px 0 0; }
        .topo-item-header:hover { background: #e9ecef; }
        .topo-item-content { padding: 15px; display: none; background: #fff; }
        .topo-item-content.active { display: block; }
        .position-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .position-tags { display: flex; gap: 8px; flex-wrap: wrap; }
        .filter-tag { padding: 2px 8px; background: #e9ecef; border-radius: 4px; font-size: 0.85em; color: #666; }

        /* 状态指示器 */
        .status-indicator { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; }
        .status-deployed { background-color: #4CAF50; }
        .status-undeployed { background-color: #FFC107; }
        .status-disabled { background-color: #F44336; }
        .status-unknown { background-color: #9E9E9E; }
        .status-tag-deployed { background-color: #E8F5E9; color: #2E7D32; }
        .status-tag-undeployed { background-color: #FFF3E0; color: #F57C00; }
        .status-tag-disabled { background-color: #FFEBEE; color: #C62828; }

        /* Rack 类型 */
        .rack-type { font-size: 0.9em; padding: 2px 8px; border-radius: 4px; background-color: #E3F2FD; color: #1976D2; margin-left: 8px; }
        .power-redundancy { font-size: 0.9em; color: #666; margin-left: 5px; }

        /* Euclid 样式 */
        .euclid-brick { border: 2px solid #2196F3 !important; background-color: rgba(33, 150, 243, 0.05); }
        .euclid-tag { background-color: #2196F3 !important; color: white !important; padding: 2px 8px !important; border-radius: 4px !important; font-size: 0.8em !important; margin-left: 8px !important; font-weight: bold !important; }
        .euclid-tag.clickable { cursor: pointer; transition: all 0.2s ease; }
        .euclid-tag.clickable:hover { background-color: #1565c0 !important; transform: scale(1.05); box-shadow: 0 2px 8px rgba(33, 150, 243, 0.4); }

        /* 电力链路 */
        .power-chain { margin: 15px 0; padding: 15px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e9ecef; }
        .power-chain-primary { border-left: 4px solid #4CAF50; }
        .power-chain-secondary { border-left: 4px solid #2196F3; }
        .power-chain-na { border-left: 4px solid #9E9E9E; }
        .chain-header { font-weight: bold; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #dee2e6; }
        .chain-path { display: flex; align-items: center; gap: 15px; flex-wrap: nowrap; margin: 15px 0; padding: 15px; background: white; border-radius: 6px; overflow-x: auto; }
        .chain-item { flex: 0 0 auto; padding: 10px 15px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; min-width: 120px; }
        .chain-label { font-size: 0.85em; color: #666; margin-bottom: 4px; }
        .chain-value { font-weight: 500; word-break: break-word; }
        .chain-arrow { color: #adb5bd; font-weight: bold; flex: 0 0 auto; }

        /* 模态框 */
        .modal-backdrop { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0,0,0,0.5); z-index: 999; }
        .position-modal { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 1000; min-width: 400px; max-width: 90vw; max-height: 80vh; overflow-y: auto; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
        .modal-title { font-size: 1.2em; font-weight: bold; color: #1976d2; }
        .modal-actions { display: flex; align-items: center; gap: 10px; }
        .modal-close { font-size: 24px; cursor: pointer; color: #666; padding: 0 5px; }
        .modal-close:hover { color: #333; }
        .copy-positions-button { display: flex; align-items: center; gap: 4px; padding: 4px 8px; background-color: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background-color 0.2s; }
        .copy-positions-button:hover { background-color: #1565c0; }
        .copy-positions-button.copied { background-color: #4caf50; }
        .position-list { display: grid; grid-template-columns: repeat(3, minmax(100px, auto)); gap: 10px; padding: 10px; width: fit-content; margin: 0 auto; }
        .position-item { padding: 8px 12px; background: #f8f9fa; border-radius: 4px; border: 1px solid #e0e0e0; display: flex; align-items: center; justify-content: space-between; min-width: 100px; }
        .position-name { flex: 0 0 auto; margin-right: 10px; }
        .euclid-position { background-color: #E3F2FD !important; border: 1px solid #90CAF9 !important; }
        .euclid-indicator { flex: 0 0 auto; background-color: #2196F3; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; white-space: nowrap; }
        .euclid-indicator.clickable { cursor: pointer; transition: all 0.2s ease; }
        .euclid-indicator.clickable:hover { background-color: #1565c0 !important; transform: scale(1.05); }
        .rack-type-tag { font-size: 0.75em; padding: 2px 6px; background-color: #e8f5e9; color: #2e7d32; border-radius: 3px; margin-left: 8px; }

        /* Euclid 弹窗 */
        .euclid-modal-icon { margin-right: 8px; }
        .euclid-modal-info { background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .euclid-info-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(33, 150, 243, 0.2); }
        .euclid-info-row:last-child { border-bottom: none; }
        .euclid-info-label { font-weight: 600; color: #1976d2; }
        .euclid-info-value { font-weight: 500; color: #333; }
        .euclid-downstream-table-container { max-height: 400px; overflow-y: auto; border: 1px solid #e0e0e0; border-radius: 8px; }
        .euclid-downstream-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .euclid-downstream-table thead { position: sticky; top: 0; z-index: 1; }
        .euclid-downstream-table th { background: #f5f5f5; padding: 12px 10px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #e0e0e0; }
        .euclid-downstream-table td { padding: 10px; border-bottom: 1px solid #f0f0f0; color: #555; }
        .euclid-downstream-table tbody tr:hover { background-color: #f8f9fa; }
        .euclid-downstream-table .no-data { text-align: center; color: #999; font-style: italic; padding: 30px; }

        /* 滚动条美化 */
        .chain-path::-webkit-scrollbar, .s3-file-list::-webkit-scrollbar, .euclid-downstream-table-container::-webkit-scrollbar, .filters-container::-webkit-scrollbar { height: 6px; width: 6px; }
        .chain-path::-webkit-scrollbar-track, .s3-file-list::-webkit-scrollbar-track, .euclid-downstream-table-container::-webkit-scrollbar-track, .filters-container::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 3px; }
        .chain-path::-webkit-scrollbar-thumb, .s3-file-list::-webkit-scrollbar-thumb, .euclid-downstream-table-container::-webkit-scrollbar-thumb, .filters-container::-webkit-scrollbar-thumb { background: #ccc; border-radius: 3px; }
        .chain-path::-webkit-scrollbar-thumb:hover, .s3-file-list::-webkit-scrollbar-thumb:hover, .euclid-downstream-table-container::-webkit-scrollbar-thumb:hover, .filters-container::-webkit-scrollbar-thumb:hover { background: #999; }

        /* 响应式 */
        @media (max-width: 768px) {
            .position-list { grid-template-columns: 1fr; }
            .stats-tables-wrapper { flex-direction: column; }
            .side-stats { flex-direction: row; width: 100%; }
            .downstream-stats, .patch-stats { flex: 1; width: auto; }
        }

        /* 内嵌逻辑选择器 - 简洁蓝色风格 */
        .stats-header-row {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            margin-bottom: 10px;
        }

        .filter-logic-inline {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .logic-label {
            font-size: 12px;
            font-weight: 600;
            color: #1976d2;
        }

        .logic-toggle {
            display: flex;
            border-radius: 4px;
            overflow: hidden;
            border: 1px solid #1976d2;
            background: white;
        }

        .logic-btn-sm {
            padding: 4px 12px;
            border: none;
            background: white;
            color: #1976d2;
            font-weight: 600;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s ease;
            line-height: 1.2;
        }

        .logic-btn-sm:first-child {
            border-right: 1px solid #1976d2;
        }

        .logic-btn-sm:hover {
            background: #e3f2fd;
        }

        .logic-btn-sm.active {
            background: #1976d2;
            color: white;
        }
    `);

    // 页面加载初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
