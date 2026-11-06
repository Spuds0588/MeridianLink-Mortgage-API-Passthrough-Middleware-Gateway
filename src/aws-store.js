/** AWS adapters: DynamoDB tenants/jobs, SQS FIFO writes, Secrets Manager, API Gateway keys. */
function createAwsStore(env = process.env) {
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, GetCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
  const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
  const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
  const { APIGatewayClient, CreateApiKeyCommand, CreateUsagePlanKeyCommand, DeleteApiKeyCommand } = require("@aws-sdk/client-api-gateway");

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const sqs = new SQSClient({});
  const secrets = new SecretsManagerClient({});
  const apiGateway = new APIGatewayClient({});

  return {
    async getSecret() {
      const res = await secrets.send(new GetSecretValueCommand({ SecretId: env.MERIDIAN_SECRET_ARN }));
      return { password: res.SecretString };
    },
    async getTenant(apiKeyId) {
      const res = await ddb.send(new GetCommand({ TableName: env.TENANT_TABLE, Key: { apiKeyId } }));
      return res.Item || null;
    },
    async putTenant(item) {
      await ddb.send(new PutCommand({ TableName: env.TENANT_TABLE, Item: item }));
    },
    async getJob(jobId) {
      const res = await ddb.send(new GetCommand({ TableName: env.JOB_TABLE, Key: { jobId } }));
      return res.Item || null;
    },
    async putJob(item) {
      await ddb.send(new PutCommand({ TableName: env.JOB_TABLE, Item: item }));
    },
    async enqueueWrite(message) {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: env.WRITE_QUEUE_URL,
          MessageBody: JSON.stringify(message),
          MessageGroupId: message.loanId,
          MessageDeduplicationId: message.jobId
        })
      );
    },
    async createApiKey({ tenantName }) {
      const created = await apiGateway.send(
        new CreateApiKeyCommand({
          name: `tenant-${tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`,
          description: `MeridianLink gateway key for ${tenantName}`,
          enabled: true,
          generateDistinctId: true
        })
      );
      try {
        await apiGateway.send(new CreateUsagePlanKeyCommand({ usagePlanId: env.USAGE_PLAN_ID, keyId: created.id, keyType: "API_KEY" }));
      } catch (err) {
        await apiGateway.send(new DeleteApiKeyCommand({ apiKey: created.id })).catch(() => {});
        throw err;
      }
      return { id: created.id, value: created.value };
    }
  };
}

module.exports = { createAwsStore };
