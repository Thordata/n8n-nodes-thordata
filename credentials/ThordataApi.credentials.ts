import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  Icon,
  INodeProperties,
} from 'n8n-workflow';

import { THORDATA_SERP_ENDPOINT } from '../endpoints';

export class ThordataApi implements ICredentialType {
  name = 'thordataApi';

  displayName = 'Thordata SERP API';

  icon: Icon = { light: 'file:thordata.svg', dark: 'file:thordata.dark.svg' };

  documentationUrl = 'https://doc.thordata.com';

  // The API key is the only secret on this credential. The service URL the node talks to is a
  // compile-time constant, so this credential cannot redirect traffic to another host.
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
      description: 'Thordata SERP API key used to authenticate search requests',
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
      url: THORDATA_SERP_ENDPOINT,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'engine=google&q=thordata&json=1&isjson=1',
    },
  };
}
