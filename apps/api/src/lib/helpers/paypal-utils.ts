import { createLogger, type Logger } from '../logger';
import { config } from '../../config';
import { prisma } from '../prisma';

const defaultLogger = createLogger('paypal-utils');

// Type definitions for TOFFS order payment data
interface ToffsBillingAddress {
    firstname?: string;
    lastname?: string;
    street?: string | string[];
    city?: string;
    postcode?: string;
    country_id?: string;
}

interface ToffsPayment {
    method?: string;
    last_trans_id?: string;
    additional_information?: string[];
}

interface ToffsStatusHistory {
    comment?: string;
}

interface ToffsOrderForPaypal {
    entity_id?: string;
    increment_id?: string;
    created_at?: string;
    updated_at?: string;
    order_currency_code?: string;
    grand_total?: number;
    total_item_count?: number;
    payment?: ToffsPayment;
    billing_address?: ToffsBillingAddress;
    status_histories?: ToffsStatusHistory[];
}

// PayPal data structure matching the database schema
export interface PaypalData {
    Paypal: {
        marketplaceOrderId: string;
        txnType: string;
        moduleName: string;
        moduleMode: string;
        reasonCode: string;
        paymentType: string;
        paymentStatus: string;
        pendingReason: string;
        invoice: string;
        mcCurrency: string;
        firstName: string;
        lastName: string;
        payerBusinessName: string;
        addressName: string;
        addressStreet: string;
        addressCity: string;
        addressState: string;
        addressZip: string;
        addressCountry: string;
        addressStatus: string;
        payerEmail: string;
        payerId: string;
        payerStatus: string;
        paymentDate: Date;
        business: string;
        receiverEmail: string;
        receiverId: string;
        txnId: string;
        parentTxnId: string;
        numCartItems: number;
        mcGross: number;
        mcFee: number;
        paymentGross: number;
        paymentFee: number;
        settleAmount: number;
        settleCurrency: string;
        exchangeRate: number;
        notifyVersion: number;
        verifySign: string;
        lastModified: Date;
        dateAdded: Date;
        memo: string;
        orderCreated: number;
        isPaymentCapture: number;
    };
}

/**
 * Extract PayPal data from TOFFS order
 * Replicates PHP function: extractPaypalDataFromToffsOrder
 *
 * @param orderData - TOFFS order data containing payment information
 * @param logger - Optional logger instance
 * @returns PayPal data object or null if no payment data found
 */
export async function extractPaypalDataFromToffsOrder(
    orderData: ToffsOrderForPaypal,
    logger?: Logger
): Promise<PaypalData | null> {
    const log = logger || defaultLogger;

    // Validate payment block
    if (!orderData.payment) {
        log.warn(
            { orderId: orderData.entity_id },
            'PayPal payment data NOT FOUND for order'
        );
        return null;
    }

    const payment = orderData.payment;
    const billingAddress = orderData.billing_address || {};
    const incrementId = orderData.increment_id || orderData.entity_id || '';

    /**
     * Magento additional_information is NOT key-value pairs.
     * It is a numeric indexed array in FIXED positions.
     */
    const additionalInformation = payment.additional_information || [];

    const paypalPaymentStatus = additionalInformation[12] || '';  // completed
    const paypalPayerId = additionalInformation[2] || '';
    const paypalPayerEmail = additionalInformation[3] || '';
    const paypalPayerStatus = additionalInformation[4] || '';     // verified
    const paypalAddressStatus = additionalInformation[5] || '';   // confirmed
    const paypalExpressCheckoutToken = additionalInformation[8] || '';  // EC-xxxx token

    // -------------------------------------------
    // Billing Street Handling
    // -------------------------------------------
    let billingStreet = '';
    if (billingAddress.street) {
        if (Array.isArray(billingAddress.street)) {
            billingStreet = (billingAddress.street[0] || '').trim();
        } else {
            billingStreet = billingAddress.street;
        }
    }

    // -------------------------------------------
    // Dates - Convert to Date objects for Prisma
    // -------------------------------------------
    const createdAt = orderData.created_at || '';
    const updatedAt = orderData.updated_at || '';

    // Convert to Date objects (Prisma expects Date objects for DateTime fields)
    const paymentDate = createdAt ? new Date(createdAt) : new Date();
    const lastModified = updatedAt ? new Date(updatedAt) : new Date();

    // -------------------------------------------
    // Memo (first status history comment)
    // -------------------------------------------
    let memo = '';
    if (orderData.status_histories && orderData.status_histories.length > 0) {
        memo = orderData.status_histories[0]?.comment || '';
    }

    // Full name
    const billingFirstname = billingAddress.firstname || '';
    const billingLastname = billingAddress.lastname || '';
    const addressName = `${billingFirstname} ${billingLastname}`.trim();

    // Get receiver email/ID from config (with fallback to empty string)
    const toffsReceiverEmail = (config as any).TOFFS_API_RECEIVER_EMAIL || '';
    const toffsReceiverId = (config as any).TOFFS_API_RECEIVER_ID || '';

    // -------------------------------------------
    // BUILD FINAL OBJECT
    // -------------------------------------------
    const paypalData: PaypalData = {
        Paypal: {
            marketplaceOrderId: incrementId,
            txnType: 'PayPal Express Checkout',
            moduleName: 'paypal (mage)',
            moduleMode: 'Toffs',
            reasonCode: '',
            paymentType: 'PayPal Express Checkout',
            paymentStatus: paypalPaymentStatus,
            pendingReason: '',
            invoice: paypalExpressCheckoutToken,
            mcCurrency: orderData.order_currency_code || '',
            firstName: billingFirstname,
            lastName: billingLastname,
            payerBusinessName: '',
            addressName: addressName,
            addressStreet: billingStreet,
            addressCity: billingAddress.city || '',
            addressState: '',
            addressZip: billingAddress.postcode || '',
            addressCountry: billingAddress.country_id || '',
            addressStatus: paypalAddressStatus,
            payerEmail: paypalPayerEmail,
            payerId: paypalPayerId,
            payerStatus: paypalPayerStatus,
            paymentDate: paymentDate,
            business: toffsReceiverEmail,
            receiverEmail: toffsReceiverEmail,
            receiverId: toffsReceiverId,
            txnId: payment.last_trans_id || '',
            parentTxnId: paypalExpressCheckoutToken,
            numCartItems: orderData.total_item_count || 0,
            mcGross: orderData.grand_total || 0,
            mcFee: 0,
            paymentGross: orderData.grand_total || 0,
            paymentFee: 0,
            settleAmount: 0,
            settleCurrency: '',
            exchangeRate: 0,
            notifyVersion: 0,
            verifySign: '',
            lastModified: lastModified,
            dateAdded: paymentDate,
            memo: memo,
            orderCreated: 0,
            isPaymentCapture: 1,
        },
    };

    log.info(
        { orderId: orderData.entity_id, incrementId },
        'PayPal DATA extracted for TOFFS Order'
    );

    return paypalData;
}


// Type helper for Prisma transaction client
type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Update PayPal table with UKSS order ID for Toffs orders
 * @param tx - Optional transaction client. If provided, operation will be part of the transaction.
 */
export async function updatePaypalOrderId(
    ukssOrderId: number, 
    marketplaceOrderId: string, 
    logger?: Logger,
    tx?: PrismaTransactionClient
): Promise<boolean> {
    const log = logger || defaultLogger;
    const client = tx || prisma;
    try {
        // await prisma.paypal.update({
        //   where: {
        //     marketplaceOrderId: marketplaceOrderId
        //   },
        //   data: {
        //     orderId: ukssOrderId
        //   }
        // })

        // Raw Query to update paypal table - This is done because prisma is not able to update the order_id field as the marketplace_order_id is not unique.
        // Using $executeRawUnsafe to support transactions
        await client.$executeRawUnsafe(
            'UPDATE paypal SET order_id = ? WHERE marketplace_order_id = ?',
            ukssOrderId,
            marketplaceOrderId
        );

        log.info({ ukssOrderId, marketplaceOrderId }, 'PayPal order ID updated successfully');
        return true;
    } catch (error) {
        log.error({ error, ukssOrderId, marketplaceOrderId }, 'Failed to update PayPal order ID');
        return false;
    }
}

