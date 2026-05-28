// =============================================================================
// G.PACK 2.0 — AgentShield Configuration
// القواعد والأمان التلقائي للكود
// =============================================================================

module.exports = {
  // القواعد الأساسية للمشروع
  rules: {
    // قاعدة 1: Vanilla JS فقط (No Frameworks)
    javascript: {
      forbiddenImports: [
        'react', 'vue', 'angular', 'jquery', 'bootstrap',
        '@mui/material', 'antd', 'chakra-ui'
      ],
      requiredPatterns: [
        /^'use strict';/, // يجب يبدأ ب use strict
        /^function _/, // الدوال يجب تبدأ ب _
      ],
      naming: {
        functions: '_camelCase', // الدوال تبدأ ب _
        variables: 'camelCase',
        constants: 'UPPER_SNAKE_CASE'
      }
    },

    // قاعدة 2: PostgreSQL RAW Queries فقط (No ORMs)
    database: {
      forbiddenImports: [
        'prisma', 'sequelize', 'typeorm', 'mongoose', 'knex'
      ],
      requiredPatterns: [
        /pool\.query\(/, // يجب يستخدم pool.query
        /BEGIN/, // يجب يبدأ transaction
        /COMMIT|ROLLBACK/ // يجب ينهي transaction
      ],
      allowedLibraries: ['pg']
    },

    // قاعدة 3: Docker & Container Architecture
    deployment: {
      requiredFiles: [
        'docker-compose.yml',
        'Dockerfile',
        '.env'
      ],
      forbiddenPatterns: [
        /localhost|127\.0\.0\.1/, // ممنوع hardcoded IPs
        /process\.env\./.source // يجب يستخدم environment variables
      ]
    }
  },

  // الكشف التلقائي للمشاكل
  autoFix: {
    // تصحيح تلقائي للمخالفات البسيطة
    enabled: true,
    rules: [
      {
        pattern: /function init\(\)/,
        replacement: 'function _init()',
        description: 'تصحيح اسم الدالة ليبدأ ب _'
      },
      {
        pattern: /async function init\(\)/,
        replacement: 'async function _init()',
        description: 'تصحيح اسم الدالة ليبدأ ب _'
      }
    ]
  },

  // المراقبة المستمرة
  monitoring: {
    // فحص كل تغيير في الكود
    watchMode: true,
    // الإبلاغ عن المشاكل فوراً
    realTimeAlerts: true,
    // منع Commit لو فيه مخالفات خطيرة
    blockCommits: true
  },

  // تقارير المشاكل
  reporting: {
    // تصنيف المشاكل
    severity: {
      critical: ['ORM usage', 'Framework imports', 'Missing transactions'],
      warning: ['Naming violations', 'Missing use strict'],
      info: ['Style improvements']
    },
    // التقرير التلقائي
    generateReport: true,
    // إرسال للتطوير
    notifyDevelopers: true
  }
};
