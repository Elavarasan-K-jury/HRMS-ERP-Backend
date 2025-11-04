const NS = process.env.REDIS_NAMESPACE || "jury";

export const keys = {
    orgById: (id) => `${NS}:org:${id}`,
    orgByDomain: (domain) => `${NS}:org:domain:${domain}`,
    orgListPage: (page) => `${NS}:org:list:page:${page}`,
    lockOrg: (domain) => `${NS}:lock:org:${domain}`
};
