import { noticePeriodPolicyClient } from '../grpc/notice_period_policy.client.js';

// Create a new notice period policy
export const createPolicy = async (payload) => {
    return new Promise((resolve, reject) => {
        noticePeriodPolicyClient.CreatePolicy(payload, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
};

// List all policies (lightweight)
export const listPolicies = async (payload) => {
    return new Promise((resolve, reject) => {
        noticePeriodPolicyClient.ListPolicies(payload, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
};

// Get a single policy
export const getPolicy = async (payload) => {
    return new Promise((resolve, reject) => {
        noticePeriodPolicyClient.GetPolicy(payload, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
};

// Update a notice period policy
export const updatePolicy = async (payload) => {
    return new Promise((resolve, reject) => {
        noticePeriodPolicyClient.UpdatePolicy(payload, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
};

// Set default policy
export const setDefaultPolicy = async (payload) => {
    return new Promise((resolve, reject) => {
        noticePeriodPolicyClient.SetDefaultPolicy(payload, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
};

// Delete a notice period policy
export const deletePolicy = async (payload) => {
    return new Promise((resolve, reject) => {
        noticePeriodPolicyClient.DeletePolicy(payload, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
};

// Get employees assigned to a policy
export const getPolicyEmployees = async (payload) => {
    return new Promise((resolve, reject) => {
        noticePeriodPolicyClient.GetPolicyEmployees(payload, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
};

// Assign employees to a policy
export const assignEmployees = async (payload) => {
    return new Promise((resolve, reject) => {
        noticePeriodPolicyClient.AssignEmployees(payload, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
};

// Remove employee from policy
export const removeEmployee = async (payload) => {
    return new Promise((resolve, reject) => {
        noticePeriodPolicyClient.RemoveEmployee(payload, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
};

// Remove all employees from policy
export const removeAllEmployees = async (payload) => {
    return new Promise((resolve, reject) => {
        noticePeriodPolicyClient.RemoveAllEmployees(payload, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
};
