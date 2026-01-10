import Razorpay from 'razorpay';
import 'dotenv/config'

export default class RazorPayPayment {
    constructor() {
        console.log('[Razorpay] Initializing Razorpay');

        this.razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        console.log('[Razorpay] Razorpay initialized successfully');
    }

    // List razorpay orders
    async listOrders(page, limit) {
        try {
            const orders = await this.razorpay.orders.all({
                count: limit,
                skip: (page - 1) * limit,
            });

            console.log('[Razorpay] Orders listed successfully', orders);
            return orders;
        } catch (error) {
            console.error('[Razorpay] Error listing orders', error);
            throw error;
        }
    }

    // Get a specific order
    async getOrder(orderId) {
        try {
            const order = await this.razorpay.orders.fetch(orderId);

            console.log('[Razorpay] Order fetched successfully', order);
            return order;
        } catch (error) {
            console.error('[Razorpay] Error fetching order', error);
            throw error;
        }
    }

    // Create an order
    async createOrder(amount, currency, receipt, payment_capture = true, paymentId) {
        try {
            const order = await this.razorpay.orders.create({
                amount,
                currency,
                receipt,
                payment_capture: payment_capture ? 1 : 0,
            });

            console.log('[Razorpay] Order created successfully', order);
            return order;
        } catch (error) {
            console.error('[Razorpay] Error creating order', error);
            throw error;
        }
    }

    // Capture a payment
    async capturePayment(paymentId, amount, currency) {
        try {
            console.log('[Razorpay] Capturing payment', {
                paymentId,
                amount,
                currency,
            });

            const payment = await this.razorpay.payments.capture(
                paymentId,
                amount,
                currency
            );

            console.log('[Razorpay] Payment captured successfully', payment);
            return payment;
        } catch (error) {
            console.error('[Razorpay] Error capturing payment', error);
            throw error;
        }
    }

    // List all payments
    async listPayments(page, limit) {
        try {
            const payments = await this.razorpay.payments.all({
                count: limit,
                skip: (page - 1) * limit,
            });

            console.log('[Razorpay] Payments listed successfully', payments);
            return payments;
        } catch (error) {
            console.error('[Razorpay] Error listing payments', error);
            throw error;
        }
    }

    // Get a specific payment
    async getPayment(paymentId) {
        try {
            const payment = await this.razorpay.payments.fetch(paymentId);

            console.log('[Razorpay] Payment fetched successfully', payment);
            return payment;
        } catch (error) {
            console.error('[Razorpay] Error fetching payment', error);
            throw error;
        }
    }

    // Fetch payments by order ID
    async fetchPaymentByOrderId(orderId) {
        try {
            const payments = await this.razorpay.orders.fetchPayments(orderId);

            console.log('[Razorpay] Payments fetched by order ID', payments);
            return payments;
        } catch (error) {
            console.error('[Razorpay] Error fetching payments by order ID', error);
            throw error;
        }
    }

    // Create a payment link
    async createPaymentLink(amount, currency, customer, notes = null, description, paymentId) {
        try {
            const currentTimeInUnix = Math.floor(Date.now() / 1000);
            const expiryTimeInUnix = currentTimeInUnix + 60 * 16; // 30 Minutes

            const paymentLink = await this.razorpay.paymentLink.create({
                upi_link: false,
                amount,
                currency,
                customer: {
                    name: customer.name,
                    email: customer.email,
                    contact: customer.contact,
                },
                notes: notes
                    ? {
                        key1: notes.key1,
                        key2: notes.key2,
                    }
                    : null,
                description,
                expire_by: expiryTimeInUnix,
                callback_url: `${process.env.GATEWAY_URL}/payment/process-payment/${paymentId}`,
                callback_method: 'get',
            });

            console.log('[Razorpay] Payment link created successfully', paymentLink);

            return {
                ...paymentLink,
                callBackUrl: `${process.env.GATEWAY_URL}/payment/process-payment/${paymentId}`,
            };
        } catch (error) {
            console.error('[Razorpay] Error creating payment link', error);
            throw error;
        }
    }
}
