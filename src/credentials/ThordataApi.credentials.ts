import type { IAuthenticateGeneric, ICredentialType, INodeProperties } from 'n8n-workflow';

export class ThordataApi implements ICredentialType {
	name = 'thordataApi';

	displayName = 'Thordata API';

	// 文档主页，可根据需要调整
	documentationUrl = 'https://doc.thordata.com';

	properties: INodeProperties[] = [
		{
			displayName: 'Scraper Token',
			name: 'token',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description:
				'Thordata Scraper / Web Unlocker token（必需）。用于 SERP API 和 Web Unlocker API。可在 Dashboard → My Account 查看。',
		},
		{
			displayName: 'Public Token (可选)',
			name: 'publicToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: false,
			description:
				'Public Token（可选）。用于 Web Scraper API 的 Authorization Bearer token。可在 Dashboard → Web Scraper → API 配置页查看。',
		},
		{
			displayName: 'Public Key (可选)',
			name: 'publicKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: false,
			description:
				'Public Key（可选）。用于管理 API（如查询余额、任务状态等）。可在 Dashboard → My Account 查看。',
		},
	];

	// 参考 thordata-python-sdk: 使用 Authorization Bearer 和 token header
	// 同时支持 apikey（根据 API 错误信息）
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.token}}',
				token: '={{$credentials.token}}',
				apikey: '={{$credentials.token}}',
			},
		},
	};
}

