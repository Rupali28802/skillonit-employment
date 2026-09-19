# Aiven for OpenSearch

The matching engine supports Aiven directly through its trusted HTTPS service URI and service username/password. Create a dedicated Aiven service user with access only to the `skillonit-jobs-v1` index. Store the values in the deployment secret manager or ignored backend `.env`:

```dotenv
MATCHING_SEARCH_PROVIDER=aiven
MATCHING_OPENSEARCH_URL=
MATCHING_OPENSEARCH_USERNAME=
MATCHING_OPENSEARCH_PASSWORD=
MATCHING_OPENSEARCH_INDEX=skillonit-jobs-v1
```

Do not put credentials in the URL. Keep `MATCHING_SEMANTIC=off` until the embedding provider and vector dimensions are validated. Run `npm run matching:index` to create/validate the strict mapping and populate eligible, verified jobs. The command redacts provider failures and never prints credentials.
