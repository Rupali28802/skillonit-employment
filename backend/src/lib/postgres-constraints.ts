// Mirrors business keys and expiry collections in the existing MongoDB store.
// Fields are scalar schema fields; no customer data or connection configuration.
export const postgresUniqueKeys: { collection: string; fields: string[]; stringFields?: string[] }[] = [
  {
    "collection": "users",
    "fields": [
      "email"
    ]
  },
  {
    "collection": "users",
    "fields": [
      "googleId"
    ],
    "stringFields": [
      "googleId"
    ]
  },
  {
    "collection": "employers",
    "fields": [
      "ownerId"
    ]
  },
  {
    "collection": "employers",
    "fields": [
      "domain"
    ]
  },
  {
    "collection": "taxonomyMappings",
    "fields": [
      "kind",
      "scheme",
      "code"
    ]
  },
  {
    "collection": "taxonomyTerms",
    "fields": [
      "kind",
      "normalized",
      "ownerId"
    ]
  },
  {
    "collection": "jobSourceVariants",
    "fields": [
      "sourceId",
      "sourceJobId"
    ]
  },
  {
    "collection": "applications",
    "fields": [
      "userId",
      "jobId"
    ]
  },
  {
    "collection": "candidateConsents",
    "fields": [
      "userId",
      "purpose"
    ]
  },
  {
    "collection": "entitlementUsage",
    "fields": [
      "userId",
      "period",
      "metric"
    ],
    "stringFields": [
      "metric"
    ]
  },
  {
    "collection": "employerVerifications",
    "fields": [
      "employerId"
    ]
  },
  {
    "collection": "studentPreferences",
    "fields": [
      "userId"
    ]
  },
  {
    "collection": "jobSourceReferences",
    "fields": [
      "sourceId",
      "sourceJobId"
    ]
  },
  {
    "collection": "jobSources",
    "fields": [
      "provider",
      "configuration.board"
    ],
    "stringFields": [
      "provider",
      "configuration.board"
    ]
  },
  {
    "collection": "studentOnboarding",
    "fields": [
      "userId"
    ]
  },
  {
    "collection": "payments",
    "fields": [
      "providerPaymentId"
    ],
    "stringFields": [
      "providerPaymentId"
    ]
  },
  {
    "collection": "entityRiskAssessments",
    "fields": [
      "entityType",
      "entityId"
    ]
  },
  {
    "collection": "passwordResets",
    "fields": [
      "userId"
    ]
  },
  {
    "collection": "canonicalJobIdentities",
    "fields": [
      "activeJobId"
    ]
  },
  {
    "collection": "locations",
    "fields": [
      "slug"
    ]
  },
  {
    "collection": "locations",
    "fields": [
      "countryCode",
      "code"
    ]
  },
  {
    "collection": "notificationDeliveries",
    "fields": [
      "notificationId",
      "channel"
    ]
  },
  {
    "collection": "occupationFamilies",
    "fields": [
      "slug"
    ]
  },
  {
    "collection": "analyticsRollups",
    "fields": [
      "day",
      "metric"
    ]
  },
  {
    "collection": "automationPreferences",
    "fields": [
      "userId"
    ]
  },
  {
    "collection": "mailboxConnections",
    "fields": [
      "userId"
    ]
  },
  {
    "collection": "mailboxConnections",
    "fields": [
      "provider",
      "providerSubject"
    ]
  },
  {
    "collection": "studentSubscriptions",
    "fields": [
      "userId"
    ]
  },
  {
    "collection": "studentSubscriptions",
    "fields": [
      "providerPaymentId"
    ],
    "stringFields": [
      "providerPaymentId"
    ]
  },
  {
    "collection": "studentSubscriptions",
    "fields": [
      "providerSubscriptionId"
    ],
    "stringFields": [
      "providerSubscriptionId"
    ]
  },
  {
    "collection": "notifications",
    "fields": [
      "userId",
      "dedupeKey"
    ],
    "stringFields": [
      "dedupeKey"
    ]
  },
  {
    "collection": "skills",
    "fields": [
      "slug"
    ]
  },
  {
    "collection": "jobLifecycleEvents",
    "fields": [
      "jobId",
      "revision"
    ]
  }
];
export const postgresExpiryCollections = [
  "analyticsRollups",
  "auditLogs",
  "cvDeletionReceipts",
  "incidentSignals",
  "jobFeedRuns",
  "jobIngestionEvents",
  "mailConnectionProofs",
  "mailConnectionVerifications",
  "mailOauthStates",
  "oauthStates",
  "passwordResets",
  "rateLimits",
  "sessions",
  "verifications",
  "workerRuns"
];
