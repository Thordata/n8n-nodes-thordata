import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  Icon,
  INodeProperties,
} from 'n8n-workflow';

import { THORDATA_DATASET_API_BASE_URL } from '../endpoints';

// The Dataset API issues its own key: a SERP key is rejected there, so Dataset requests must not
// reuse the thordataApi credential. Keeping it separate also keeps each key scoped to one service.
export class ThordataDatasetApi implements ICredentialType {
  name = 'thordataDatasetApi';

  displayName = 'Thordata Dataset API';

  icon: Icon = { light: 'file:thordata.svg', dark: 'file:thordata.dark.svg' };

  documentationUrl = 'https://doc.thordata.com';

  properties: INodeProperties[] = [
    {
      displayName: 'Dataset API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      description: 'Thordata Dataset API key used to list, purchase, download and deliver datasets',
    },
    {
      displayName: 'AWS Access Key ID',
      name: 'accessKeyId',
      type: 'string',
      default: '',
      required: false,
      description: 'Fill this field only when delivering a dataset to Amazon S3',
    },
    {
      displayName: 'AWS Secret Access Key',
      name: 'secretAccessKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: false,
      description: 'Fill this field only when delivering a dataset to Amazon S3',
    },
    {
      displayName: 'Snowflake Password',
      name: 'password',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: false,
      description: 'Fill this field only when delivering a dataset to Snowflake',
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

  // Lists the catalog, so a 2xx response proves the key is accepted by the Dataset API. Unlike the
  // SERP test this reads a catalog and does not consume credits.
  test: ICredentialTestRequest = {
    request: {
      method: 'GET',
      url: `${THORDATA_DATASET_API_BASE_URL}/datasets`,
    },
  };
}
