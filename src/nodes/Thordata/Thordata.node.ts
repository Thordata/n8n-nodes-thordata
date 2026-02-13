import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import axios, { type AxiosInstance } from 'axios';

type SearchEngineResponse = IDataObject;
type UniversalScrapeResponse = IDataObject | string;
type SmartScrapeResponse = IDataObject;

const SCRAPER_API_BASE_URL = 'https://scraperapi.thordata.com';
const WEB_UNLOCKER_BASE_URL = 'https://webunlocker.thordata.com';

export class Thordata implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Thordata',
		name: 'thordata',
		group: ['transform'],
		version: 1,
		description: 'Use Thordata cloud APIs for web search and scraping',
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
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				required: true,
				options: [
					{
						name: 'Search Engine',
						value: 'searchEngine',
						description: 'Search the web and return structured results',
					},
					{
						name: 'Universal Scrape',
						value: 'universalScrape',
						description: 'Scrape a webpage into structured content',
					},
					{
						name: 'Smart Scrape',
						value: 'smartScrape',
						description: 'AI-assisted smart scraping for complex pages',
					},
				],
				default: 'searchEngine',
			},

			// ---------------------------------------------------------------------
			// Search Engine
			// ---------------------------------------------------------------------
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['searchEngine'],
					},
				},
				placeholder: 'latest AI trends',
			},
			{
				displayName: 'Engine',
				name: 'engine',
				type: 'options',
				default: 'google',
				options: [
					{ name: 'Google', value: 'google' },
					{ name: 'Bing', value: 'bing' },
					{ name: 'Yandex', value: 'yandex' },
				],
				displayOptions: {
					show: {
						operation: ['searchEngine'],
					},
				},
			},
			{
				displayName: 'Max Results',
				name: 'num',
				type: 'number',
				default: 10,
				typeOptions: {
					minValue: 1,
					maxValue: 50,
				},
				displayOptions: {
					show: {
						operation: ['searchEngine'],
					},
				},
				description: 'Maximum number of results to return',
			},

			// ---------------------------------------------------------------------
			// Universal Scrape
			// ---------------------------------------------------------------------
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com',
				displayOptions: {
					show: {
						operation: ['universalScrape', 'smartScrape'],
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
				description: 'Whether to enable JavaScript rendering',
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				default: 'html',
				options: [
					{ name: 'HTML', value: 'html' },
					{ name: 'Screenshot (PNG)', value: 'png' },
				],
				displayOptions: {
					show: {
						operation: ['universalScrape'],
					},
				},
				description: 'Output format defined by Thordata Web Unlocker API.',
			},

			// ---------------------------------------------------------------------
			// Smart Scrape
			// ---------------------------------------------------------------------
			{
				displayName: 'Instructions',
				name: 'instructions',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				placeholder: 'Extract product name, price, and main features',
				description: 'Natural language instructions for what data to extract',
				displayOptions: {
					show: {
						operation: ['smartScrape'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnItems: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('thordataApi');
		const token = credentials.token as string;

		if (!token || token.trim() === '') {
			throw new Error('Thordata Scraper Token is required. Please configure it in credentials.');
		}

		// 参考 thordata-python-sdk: 使用 application/x-www-form-urlencoded 和 Authorization Bearer
		// 同时支持 token 和 apikey header（根据错误信息，API 可能期望 apikey）
		const scraperClient: AxiosInstance = axios.create({
			baseURL: SCRAPER_API_BASE_URL,
			headers: {
				Authorization: `Bearer ${token}`,
				token,
				apikey: token, // 根据错误信息，API 期望 apikey header
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			timeout: 300_000,
		});

		const unlockerClient: AxiosInstance = axios.create({
			baseURL: WEB_UNLOCKER_BASE_URL,
			headers: {
				Authorization: `Bearer ${token}`,
				token,
				apikey: token, // 根据错误信息，API 期望 apikey header
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			timeout: 300_000,
		});

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

				let responseData: SearchEngineResponse | UniversalScrapeResponse | SmartScrapeResponse;

				if (operation === 'searchEngine') {
					responseData = await callSearchEngine.call(this, scraperClient, i);
				} else if (operation === 'universalScrape') {
					responseData = await callUniversalScrape.call(this, unlockerClient, i);
				} else if (operation === 'smartScrape') {
					responseData = await callSmartScrape.call(this, unlockerClient, i);
				} else {
					throw new Error(`Unknown operation: ${operation}`);
				}

				returnItems.push({
					json: responseData as IDataObject,
				});
			} catch (error) {
				if (axios.isAxiosError(error)) {
					const status = error.response?.status;
					const statusText = error.response?.statusText;
					const message = error.response?.data?.msg || error.response?.data?.message || error.message;
					throw new Error(
						`Thordata API Error (${status || 'Network'}): ${message || statusText || 'Request failed'}`,
					);
				}
				throw error;
			}
		}

		return [returnItems];
	}
}

async function callSearchEngine(
	this: IExecuteFunctions,
	client: AxiosInstance,
	itemIndex: number,
): Promise<SearchEngineResponse> {
	const query = this.getNodeParameter('query', itemIndex) as string;
	const engine = this.getNodeParameter('engine', itemIndex) as string;
	const num = this.getNodeParameter('num', itemIndex) as number;

	if (!query || query.trim() === '') {
		throw new Error('Query parameter is required for Search Engine operation.');
	}

	// 参考 thordata-python-sdk 的 SerpRequest.to_payload() 方法
	// 关键：使用 engine 参数（不是 url），所有参数都是字符串
	const payload: IDataObject = {
		engine: engine.toLowerCase(),
		json: '1', // json=1 表示返回 JSON 格式
		num: (num || 10).toString(),
	};

	// 查询参数：Google/Bing 使用 q，Yandex 使用 text
	if (engine.toLowerCase() === 'yandex') {
		payload.text = query;
	} else {
		payload.q = query;
	}

	// Bing 使用 count 而不是 num
	if (engine.toLowerCase() === 'bing') {
		payload.count = payload.num;
		delete payload.num;
	}

	// 使用 URLSearchParams 格式（application/x-www-form-urlencoded）
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(payload)) {
		if (value !== undefined && value !== null) {
			params.append(key, String(value));
		}
	}

	const { data } = await client.post<SearchEngineResponse>('/request', params.toString());
	return data;
}

async function callUniversalScrape(
	this: IExecuteFunctions,
	client: AxiosInstance,
	itemIndex: number,
): Promise<UniversalScrapeResponse> {
	const url = this.getNodeParameter('url', itemIndex) as string;
	const jsRender = this.getNodeParameter('jsRender', itemIndex) as boolean;
	const outputFormat = this.getNodeParameter('outputFormat', itemIndex) as string;

	if (!url || url.trim() === '') {
		throw new Error('URL parameter is required for Universal Scrape operation.');
	}

	// 确保 URL 有协议前缀
	let normalizedUrl = url.trim();
	if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
		normalizedUrl = `https://${normalizedUrl}`;
	}

	// 参考 thordata-python-sdk 的 UniversalScrapeRequest.to_payload() 方法
	// 关键：js_render 必须是字符串 "True" 或 "False"（不是 "1"/"0"）
	// type 必须是小写 "html" 或 "png"（不是 "HTML"/"PNG"）
	const params = new URLSearchParams();
	params.append('url', normalizedUrl);
	params.append('js_render', jsRender ? 'True' : 'False');
	params.append('type', outputFormat === 'png' ? 'png' : 'html');

	const { data } = await client.post<UniversalScrapeResponse>('/request', params.toString());
	return data;
}

async function callSmartScrape(
	this: IExecuteFunctions,
	client: AxiosInstance,
	itemIndex: number,
): Promise<SmartScrapeResponse> {
	const url = this.getNodeParameter('url', itemIndex) as string;
	const instructions = this.getNodeParameter('instructions', itemIndex) as string;

	if (!url || url.trim() === '') {
		throw new Error('URL parameter is required for Smart Scrape operation.');
	}

	if (!instructions || instructions.trim() === '') {
		throw new Error('Instructions parameter is required for Smart Scrape operation.');
	}

	// 确保 URL 有协议前缀
	let normalizedUrl = url.trim();
	if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
		normalizedUrl = `https://${normalizedUrl}`;
	}

	// SmartScrape：当前实现为"先通过 Unlocker 抓取 HTML，再与指令一起返回"，
	// 方便在后续 LLM / Code 节点中根据 instructions 做二次结构化。
	const params = new URLSearchParams();
	params.append('url', normalizedUrl);
	params.append('js_render', 'True'); // 必须是字符串 "True"
	params.append('type', 'html'); // 必须是小写

	const { data } = await client.post<UniversalScrapeResponse>('/request', params.toString());

	const result: SmartScrapeResponse = {
		url: normalizedUrl,
		instructions,
		raw: data,
	};

	return result;
}

