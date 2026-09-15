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
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  };

  // n8n 要求社区节点凭据提供可执行的测试；这里发一个最小 SERP 查询，
  // 能返回 2xx 即认为凭据可用，失败会直接抛出上游状态码。注意：测试成功会消耗 1 个 credit。
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
