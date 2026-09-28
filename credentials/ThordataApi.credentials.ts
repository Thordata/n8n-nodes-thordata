import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  Icon,
  INodeProperties,
} from 'n8n-workflow';

export class ThordataApi implements ICredentialType {
  name = 'thordataApi';

  displayName = 'Thordata API';

  icon: Icon = { light: 'file:thordata.svg', dark: 'file:thordata.dark.svg' };

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
    {
      displayName: 'Dataset API Base URL',
      name: 'datasetEndpoint',
      type: 'string',
      default: 'https://api.thordata.com/api/n8n',
      required: true,
      description: 'Thordata Dataset API base URL. Dataset fields and delivery options are loaded dynamically.',
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

  // n8n requires community-node credentials to provide an executable test, so this sends one
  // minimal SERP request: a 2xx response means the credential works, a failure surfaces the
  // upstream status code directly. Note that a successful test consumes one credit.
  test: ICredentialTestRequest = {
    request: {
      method: 'POST',
      url: '={{$credentials.endpoint}}',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'engine=google&q=thordata&json=1&isjson=1',
    },
  };
}
