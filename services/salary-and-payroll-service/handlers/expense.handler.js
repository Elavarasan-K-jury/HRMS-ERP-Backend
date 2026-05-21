import { prisma } from '@jury-hrms/db/client.js';
import { grpc } from '@jury-hrms/proto';
import { sendExpenseRaisedEmail, sendExpenseStatusEmail } from '@jury-hrms/mailer';

async function validateOrganization(organization_id) {
    if (!organization_id) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'organization_id is required',
        };
    }

    const organization = await prisma.organizations.findFirst({
        where: { id: organization_id },
    });

    if (!organization) {
        throw {
            code: grpc.status.NOT_FOUND,
            message: 'Organization not found',
        };
    }

    return organization;
}

async function validateEmployee(employee_id, organization_id) {
    if (!employee_id) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'employee_id is required',
        };
    }

    const employee = await prisma.organizationEmployees.findFirst({
        where: {
            id: employee_id,
            organizationId: organization_id,
            deletedAt: null,
        },
    });

    if (!employee) {
        throw {
            code: grpc.status.NOT_FOUND,
            message: 'Employee not found',
        };
    }

    return employee;
}

async function validateExpense(expense_id, organization_id) {
    if (!expense_id) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'expense_id is required',
        };
    }

    const expense = await prisma.expenses.findFirst({
        where: {
            id: expense_id,
            organizationId: organization_id,
            deletedAt: null,
        },
        include: {
            employee: true,
            approver: true,
        },
    });

    if (!expense) {
        throw {
            code: grpc.status.NOT_FOUND,
            message: 'Expense not found',
        };
    }

    return expense;
}

function buildDateFilter(from_date, to_date) {
    if (!from_date && !to_date) return undefined;

    const filter = {};

    if (from_date) {
        filter.gte = new Date(from_date);
    }

    if (to_date) {
        filter.lte = new Date(to_date);
    }

    return filter;
}

function formatExpense(expense) {
    return {
        id: expense.id,
        organization_id: expense.organizationId,
        employee_id: expense.employeeId,

        employee_name: expense.employee?.fullName || '',
        employee_code: expense.employee?.employeeCode || '',

        type: expense.type,
        amount: expense.amount,
        description: expense.description || '',
        receipt_url: expense.receiptUrl || '',

        status: expense.status,

        approver_id: expense.approverId || '',
        approver_name: expense.approver?.name || '',
        approved_at: expense.approvedAt ? expense.approvedAt.toISOString() : '',

        created_at: expense.createdAt ? expense.createdAt.toISOString() : '',
        updated_at: expense.updatedAt ? expense.updatedAt.toISOString() : '',
        deleted_at: expense.deletedAt ? expense.deletedAt.toISOString() : '',
    };
}

// =========================================================
// Employee — Register Expense
// =========================================================
export const registerExpense = async (call, callback) => {
    try {
        const {
            organization_id,
            employee_id,
            type,
            amount,
            description,
            receipt_url,
        } = call.request;

        await validateOrganization(organization_id);
        await validateEmployee(employee_id, organization_id);

        if (!amount || amount <= 0) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'Valid amount is required',
            });
        }

        if (!description) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'description is required',
            });
        }


        const expense = await prisma.expenses.create({
            data: {
                organizationId: organization_id,
                employeeId: employee_id,
                type: type || 'OTHER',
                amount,
                description,
                receiptUrl: receipt_url || null,
                status: 'PENDING',
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            },
            include: {
                employee: true,
                approver: true,
            },
        });

        const organisationAdmin = await prisma.organizationEmployees.findFirst({
            where: {
                organizationId: organization_id,
                isAdmin: true,
            },
        })

        sendExpenseRaisedEmail(organisationAdmin.email, expense)

        return callback(null, {
            success: true,
            message: 'Expense registered successfully',
            expense: formatExpense(expense),
        });

    } catch (e) {
        console.error('Register Expense Error:', e);

        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

// =========================================================
// Employee — Fetch Own Expenses
// =========================================================
export const getMyExpenses = async (call, callback) => {
    try {
        const {
            organization_id,
            employee_id,
            from_date,
            to_date,
            search,
            type,
            status,
            page = 1,
            limit = 10,
        } = call.request;

        await validateOrganization(organization_id);
        await validateEmployee(employee_id, organization_id);

        const where = {
            organizationId: organization_id,
            employeeId: employee_id,
            deletedAt: null,
        };

        const dateFilter = buildDateFilter(from_date, to_date);
        if (dateFilter) {
            where.createdAt = dateFilter;
        }

        if (search) {
            where.description = {
                contains: search,
                mode: 'insensitive',
            };
        }
        if (!type || type != 'ALL') {
            where.type = type;
        }
        if (status && status != 'ALL') {
            where.status = status;
        }

        const skip = (page - 1) * limit;

        const [expenses, totalCount] = await Promise.all([
            prisma.expenses.findMany({
                where,
                skip,
                take: limit,
                orderBy: {
                    createdAt: 'desc',
                },
                include: {
                    employee: true,
                    approver: true,
                },
            }),
            prisma.expenses.count({ where }),
        ]);

        return callback(null, {
            success: true,
            message: 'Expenses fetched successfully',
            expenses: expenses.map(formatExpense),
            total_count: totalCount,
            page,
            limit,
        });

    } catch (e) {
        console.error('Get My Expenses Error:', e);

        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

// =========================================================
// Employee — Update Expense
// =========================================================
export const updateExpense = async (call, callback) => {
    try {
        const {
            organization_id,
            employee_id,
            expense_id,
            type,
            amount,
            description,
            receipt_url,
        } = call.request;

        await validateOrganization(organization_id);
        await validateEmployee(employee_id, organization_id);

        const expense = await prisma.expenses.findFirst({
            where: {
                id: expense_id,
                organizationId: organization_id,
                employeeId: employee_id,
                deletedAt: null,
            },
        });

        if (!expense) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Expense not found',
            });
        }

        if (expense.status !== 'PENDING') {
            return callback({
                code: grpc.status.FAILED_PRECONDITION,
                message: 'Only pending expenses can be updated',
            });
        }

        const updatedExpense = await prisma.expenses.update({
            where: { id: expense.id },
            data: {
                type: type || expense.type,
                amount: amount || expense.amount,
                description: description || expense.description,
                receiptUrl: receipt_url || expense.receiptUrl,
                updatedAt: new Date(),
            },
            include: {
                employee: true,
                approver: true,
            },
        });

        return callback(null, {
            success: true,
            message: 'Expense updated successfully',
            expense: formatExpense(updatedExpense),
        });

    } catch (e) {
        console.error('Update Expense Error:', e);

        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

// =========================================================
// Employee — Delete Expense
// =========================================================
export const deleteExpense = async (call, callback) => {
    try {
        const {
            organization_id,
            employee_id,
            expense_id,
        } = call.request;

        await validateOrganization(organization_id);
        await validateEmployee(employee_id, organization_id);

        const expense = await prisma.expenses.findFirst({
            where: {
                id: expense_id,
                organizationId: organization_id,
                employeeId: employee_id,
                deletedAt: null,
            },
        });

        if (!expense) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Expense not found',
            });
        }

        if (expense.status !== 'PENDING') {
            return callback({
                code: grpc.status.FAILED_PRECONDITION,
                message: 'Only pending expenses can be deleted',
            });
        }

        await prisma.expenses.update({
            where: { id: expense.id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        });

        return callback(null, {
            success: true,
            message: 'Expense deleted successfully',
        });

    } catch (e) {
        console.error('Delete Expense Error:', e);

        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

// =========================================================
// Admin — Fetch All Expenses
// =========================================================
export const getAllExpenses = async (call, callback) => {
    try {
        const {
            organization_id,
            from_date,
            to_date,
            employee_id,
            type,
            status,
            search,
            page = 1,
            limit = 10,
        } = call.request;

        await validateOrganization(organization_id);

        const where = {
            organizationId: organization_id,
            deletedAt: null,
        };

        const dateFilter = buildDateFilter(from_date, to_date);
        if (dateFilter) {
            where.createdAt = dateFilter;
        }

        if (employee_id) {
            where.employeeId = employee_id;
        }

        if (type && type != 'ALL') {
            where.type = type;
        }

        if (status && status != 'ALL') {
            where.status = status;
        }


        if (search) {
            where.OR = [
                {
                    description: {
                        contains: search,
                        mode: 'insensitive',
                    },
                },
                {
                    employee: {
                        name: {
                            contains: search,
                            mode: 'insensitive',
                        },
                    },
                },
            ];
        }

        const skip = (page - 1) * limit;

        const [expenses, totalCount] = await Promise.all([
            prisma.expenses.findMany({
                where,
                skip,
                take: limit,
                orderBy: {
                    createdAt: 'desc',
                },
                include: {
                    employee: true,
                    approver: true,
                },
            }),
            prisma.expenses.count({ where }),
        ]);

        return callback(null, {
            success: true,
            message: 'Expenses fetched successfully',
            expenses: expenses.map(formatExpense),
            total_count: totalCount,
            page,
            limit,
        });

    } catch (e) {
        console.error('Get All Expenses Error:', e);

        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

// =========================================================
// Admin — Approve / Reject Expense
// =========================================================
export const updateExpenseStatus = async (call, callback) => {
    try {
        const {
            organization_id,
            expense_id,
            approver_id,
            status,
        } = call.request;

        let approvedBy = null;

        await validateOrganization(organization_id);
        if (approver_id == 'SUPER_ADMIN') {
            const organisationAdmin = await prisma.organizationEmployees.findFirst({
                where: {
                    organizationId: organization_id,
                    isAdmin: true,
                },
            })

            approvedBy = organisationAdmin?.id

        } else {
            await validateEmployee(approver_id, organization_id);
            approvedBy = approver_id
        }

        const expense = await validateExpense(expense_id, organization_id);

        if (expense.status !== 'PENDING') {
            return callback({
                code: grpc.status.FAILED_PRECONDITION,
                message: 'Only pending expenses can be approved or rejected',
            });
        }

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'status must be APPROVED or REJECTED',
            });
        }

        const updatedExpense = await prisma.expenses.update({
            where: { id: expense.id },
            data: {
                status,
                approverId: approvedBy,
                approvedAt: status === 'APPROVED' ? new Date() : null,
                updatedAt: new Date(),
            },
            include: {
                employee: true,
                approver: true,
            },
        });

        await sendExpenseStatusEmail(updatedExpense.employee.email, updatedExpense);

        return callback(null, {
            success: true,
            message: `Expense ${status.toLowerCase()} successfully`,
            expense: formatExpense(updatedExpense),
        });

    } catch (e) {
        console.error('Update Expense Status Error:', e);

        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

// =========================================================
// Admin — View Expense Details
// =========================================================
export const getExpenseDetails = async (call, callback) => {
    try {
        const {
            organization_id,
            expense_id,
        } = call.request;

        await validateOrganization(organization_id);

        const expense = await validateExpense(expense_id, organization_id);

        return callback(null, {
            success: true,
            message: 'Expense details fetched successfully',
            expense: formatExpense(expense),
        });

    } catch (e) {
        console.error('Get Expense Details Error:', e);

        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

// =========================================================
// Admin — Delete Expense
// =========================================================
export const adminDeleteExpense = async (call, callback) => {
    try {
        const {
            organization_id,
            expense_id,
        } = call.request;

        await validateOrganization(organization_id);

        const expense = await validateExpense(expense_id, organization_id);

        await prisma.expenses.update({
            where: { id: expense.id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        });

        return callback(null, {
            success: true,
            message: 'Expense deleted successfully',
        });

    } catch (e) {
        console.error('Admin Delete Expense Error:', e);

        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};