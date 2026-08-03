const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'request_id'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        request_id: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  },
};

const openApiV1 = {
  openapi: '3.1.0',
  info: {
    title: 'DrapixAI REST API',
    version: '1.0.0',
    description: 'Versioned server API for DrapixAI Standard virtual try-on. Live and sandbox credentials are accepted only by their matching isolated deployment. SDK and REST requests share the account quota.',
    'x-drapixai-usage-billing': {
      counted: 'The first successful, publishable HTTP 200 try-on result consumes one unit.',
      notCounted: [
        'HTTP 422 quality-gate rejection',
        'validation, authentication, rate-limit, or generation failure',
        'idempotent replay of an already-counted result',
        'token, usage, webhook, and OpenAPI operations',
      ],
      overage: 'Public plans stop at the monthly quota and do not add automatic overage charges.',
    },
  },
  servers: [
    { url: 'https://api.drapixai.com/v1', description: 'Live' },
    { url: 'https://sandbox-api.drapixai.com/v1', description: 'Sandbox' },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    '/tokens': {
      post: {
        summary: 'Exchange a server key for a 15-minute scoped access token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['scopes'],
                properties: {
                  scopes: { type: 'array', items: { enum: ['api:tryon', 'api:usage', 'api:webhooks'] } },
                  product_ids: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 160 } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Scoped access token' },
          '401': { description: 'Invalid server key', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/tryons': {
      post: {
        summary: 'Generate one Standard virtual try-on',
        parameters: [
          { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', minLength: 16, maxLength: 128 } },
          { in: 'header', name: 'X-Request-Id', required: false, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['person_image', 'productId', 'shopper_consent', 'privacy_policy_version'],
                properties: {
                  person_image: { type: 'string', format: 'binary' },
                  productId: { type: 'string' },
                  garment_type: { type: 'string', enum: ['upper'] },
                  quality: { type: 'string', enum: ['standard'] },
                  shopper_consent: { type: 'string', enum: ['true'], description: 'Explicit permission for transient try-on processing.' },
                  privacy_policy_version: { type: 'string', enum: ['2026-08-04'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Approved PNG result. The first successful response consumes one usage unit. Quality and latency metadata are returned in X-DrapixAI-* headers.',
            content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
          },
          '422': { description: 'Quality gate rejected the result. No usage unit is consumed.', content: { 'application/json': { schema: errorSchema } } },
          '409': { description: 'Duplicate request is processing, or its transient response bytes are no longer retained.', content: { 'application/json': { schema: errorSchema } } },
          '429': { description: 'Quota or rate limit exceeded', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/tryons/{id}': {
      get: {
        summary: 'Read tenant-scoped try-on metadata',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Try-on metadata' }, '404': { description: 'Not found' } },
      },
    },
    '/usage': {
      get: {
        summary: 'Read successful try-on usage, quota, and remaining capacity',
        responses: { '200': { description: 'Usage summary' } },
      },
    },
    '/webhook-endpoints': {
      get: { summary: 'List webhook endpoints', responses: { '200': { description: 'Endpoint list' } } },
      post: {
        summary: 'Register a signed HTTPS webhook endpoint',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'events'],
                properties: {
                  url: { type: 'string', format: 'uri' },
                  events: { type: 'array', items: { enum: ['tryon.completed', 'tryon.rejected'] } },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Endpoint and one-time signing secret' } },
      },
    },
    '/webhook-endpoints/{id}': {
      delete: {
        summary: 'Disable a tenant-owned webhook endpoint',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Disabled' }, '404': { description: 'Not found' } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
    },
    schemas: { Error: errorSchema },
  },
} as const;

export default openApiV1;
