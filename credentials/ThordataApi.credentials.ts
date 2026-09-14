import type { IAuthenticateGeneric, ICredentialType, INodeProperties } from 'n8n-workflow';

export class ThordataApi implements ICredentialType {
  name = 'thordataApi';

  displayName = 'Thordata API';

  documentationUrl = 'https://doc.thordata.com';

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      description: 'Thordata API Key used to authenticate SERP requests.',
    },
    {
      displayName: 'SERP Endpoint',
      name: 'endpoint',
      type: 'string',
      default: 'https://scraperapi.thordata.com/request',
      required: true,
      description: 'Change only for internal or development environments.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  };
}
