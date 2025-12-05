import {
	IAuthenticateGeneric,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ThordataApi implements ICredentialType {
	name = 'thordataApi';
	displayName = 'Thordata API';
	documentationUrl = 'https://doc.thordata.com/';
	properties: INodeProperties[] = [
		{
			displayName: 'Scraper Token',
			name: 'scraperToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'Your Thordata Scraper Token (found in Dashboard)',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: 'Bearer ={{$credentials.scraperToken}}',
			},
		},
	};
}