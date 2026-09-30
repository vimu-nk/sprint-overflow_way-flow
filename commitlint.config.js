export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', ['web', 'api', 'planner', 'shared', 'infra', 'deps', 'release']],
  },
};
