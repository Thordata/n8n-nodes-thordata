import {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

export class Thordata implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Thordata',
		name: 'thordata',
		icon: 'file:thordata.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Use Thordata Proxies and Scraping APIs',
		defaults: {
			name: 'Thordata',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'thordataApi',
				required: true,
			},
		],
		properties: [
			// ----------------------------------
			//         Operation Selection
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'SERP Search',
						value: 'serpSearch',
						description: 'Search Google, Bing, Yandex, etc.',
					},
					{
						name: 'Universal Scrape',
						value: 'universalScrape',
						description: 'Scrape any URL with browser rendering',
					},
				],
				default: 'serpSearch',
			},

			// ----------------------------------
			//         SERP Search Options
			// ----------------------------------
			{
				displayName: 'Search Engine',
				name: 'engine',
				type: 'options',
				options: [
					{ name: 'Google', value: 'google' },
					{ name: 'Bing', value: 'bing' },
					{ name: 'Yandex', value: 'yandex' },
					{ name: 'DuckDuckGo', value: 'duckduckgo' },
				],
				default: 'google',
				displayOptions: {
					show: {
						operation: ['serpSearch'],
					},
				},
				description: 'The search engine to use',
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				placeholder: 'e.g. Thordata proxies',
				required: true,
				displayOptions: {
					show: {
						operation: ['serpSearch'],
					},
				},
				description: 'The search term',
			},
			{
				displayName: 'Limit',
				name: 'num',
				type: 'number',
				default: 10,
				displayOptions: {
					show: {
						operation: ['serpSearch'],
					},
				},
				description: 'Number of results to return',
			},

			// ----------------------------------
			//    Universal Scrape Options
			// ----------------------------------
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				placeholder: 'https://www.example.com',
				required: true,
				displayOptions: {
					show: {
						operation: ['universalScrape'],
					},
				},
				description: 'The URL to scrape',
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{ name: 'HTML', value: 'html' },
					{ name: 'PNG (Screenshot)', value: 'png' },
				],
				default: 'html',
				displayOptions: {
					show: {
						operation: ['universalScrape'],
					},
				},
			},
			{
				displayName: 'Render JavaScript',
				name: 'jsRender',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						operation: ['universalScrape'],
					},
				},
				description: 'Whether to render JavaScript on the page',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		const credentials = await this.getCredentials('thordataApi');
		const scraperToken = credentials.scraperToken as string;

		const engineDefaults: { [key: string]: string } = {
			google: 'google.com',
			bing: 'bing.com',
			duckduckgo: 'duckduckgo.com',
			yandex: 'yandex.com',
		};

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData;

				const headers: IDataObject = {
					'Authorization': `Bearer ${scraperToken}`,
				};

				if (operation === 'serpSearch') {
					// SERP 搜索逻辑
					const engine = this.getNodeParameter('engine', i) as string;
					const query = this.getNodeParameter('query', i) as string;
					const num = this.getNodeParameter('num', i) as number;

					const queryParamName = engine === 'yandex' ? 'text' : 'q';
					const targetUrl = engineDefaults[engine] || 'google.com';

					const bodyParams = new URLSearchParams();
					bodyParams.append('engine', engine);
					bodyParams.append('num', num.toString());
					bodyParams.append(queryParamName, query);
					bodyParams.append('url', targetUrl);
					bodyParams.append('json', '1');

					const options: any = {
						method: 'POST',
						uri: 'https://scraperapi.thordata.com/request',
						headers: {
							...headers,
							'Content-Type': 'application/x-www-form-urlencoded',
						},
						body: bodyParams.toString(),
						json: true,
					};
					responseData = await this.helpers.request(options);

				} else if (operation === 'universalScrape') {
					// Universal Scrape 逻辑
					let url = this.getNodeParameter('url', i) as string;
					const outputFormat = this.getNodeParameter('outputFormat', i) as string;
					const jsRender = this.getNodeParameter('jsRender', i) as boolean;

					// 关键修复：自动补全 URL 协议头
					if (!url.startsWith('http://') && !url.startsWith('https://')) {
						url = 'https://' + url;
					}

					// 构造符合 SDK 标准的参数对象
					const formData = {
						url: url, // 现在它一定是 http 开头的了
						type: outputFormat.toLowerCase(),
						js_render: jsRender ? 'True' : 'False', // Python 风格布尔值
						block_resources: 'False', // SDK 默认参数
					};

					console.log('--- Thordata Debug Corrected ---');
					console.log('Final URL:', url);
					console.log('--- Thordata Debug End ---');

					const options: any = {
						method: 'POST',
						uri: 'https://universalapi.thordata.com/request',
						headers: headers, // Authorization
						form: formData,   // 自动处理 Form Data
						json: false,      // 禁用 n8n 的 JSON 智能处理
						encoding: null,   // 接收二进制数据 (Buffer)
					};

					const bufferResponse = await this.helpers.request(options);

					// 手动处理响应
					const stringResponse = bufferResponse.toString('utf8');
					
					try {
						// 尝试解析 JSON
						responseData = JSON.parse(stringResponse);
					} catch (e) {
						// 解析失败
						if (outputFormat === 'png') {
							// PNG 模式：返回二进制数据
							// n8n 需要二进制数据包装在特定的格式中
							// 这里我们简单返回一个标识，或者可以深入集成 n8n 的 Binary Data
							returnData.push({
								json: {
									message: "Screenshot captured successfully",
									format: "png"
								},
								binary: {
									data: {
										data: bufferResponse.toString('base64'),
										mimeType: 'image/png',
										fileName: 'screenshot.png',
									}
								}
							} as any);
							continue; // 跳过下面的默认 push
						} else {
							// HTML 模式：直接返回文本
							responseData = { 
								html: stringResponse 
							};
						}
					}
				}

				returnData.push({ json: responseData } as any);

			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as any).message } } as any);
					continue;
				}
				throw error;
			}
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}