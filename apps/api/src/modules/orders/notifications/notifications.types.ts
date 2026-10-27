/**
 * Notification type definitions — raw query result shapes and function params.
 * Requirements: REQ-08-001 through REQ-08-013
 */

// ---------------------------------------------------------------------------
// Store brand resolution (REQ-08-001)
// ---------------------------------------------------------------------------

/** Resolved store brand for email sending */
export interface StoreBrand {
  storeId: number;
  storeName: string;
  storeEmail: string;
  storeUrl: string;
  storeLogo: string | null;
}

// ---------------------------------------------------------------------------
// Email dispatch (REQ-08-009, REQ-08-012)
// ---------------------------------------------------------------------------

/** Parameters for sending a status update email */
export interface StatusEmailParams {
  orderId: number;
  newStatus: number;
  customerName: string;
  customerEmail: string;
  orderSite: number;
  statusName: string;
  datePurchased: string | null;
  comments: string;
  notifyComments: boolean;
  useOriginalEmail: boolean;
  sendMessageAutomatically: boolean;
  fruugoOrdersId: string | null;
  amazonOrdersId: string | null;
}

// ---------------------------------------------------------------------------
// Email queue (REQ-08-006, REQ-08-007)
// ---------------------------------------------------------------------------

/** Row from orders_email table */
export interface OrdersEmailRow {
  oe_id: number;
  order_id: number | null;
  to_name: string;
  to_address: string;
  email_subject: string;
  email_text: string;
  from_email_name: string;
  from_email_address: string;
  module: string;
  data: string;
  attach: string;
  email_sent_status: string;
  date_created: Date | string | null;
  date_modified: Date | string | null;
  error_message: string | null;
}

/** Insert params for email queue */
export interface EmailQueueInsert {
  orderId: number | null;
  toName: string;
  toAddress: string;
  subject: string;
  textBody: string;
  fromName: string;
  fromAddress: string;
  module: string;
  data: string;
  attach: string;
}

// ---------------------------------------------------------------------------
// Order query system (REQ-08-011, REQ-08-013)
// ---------------------------------------------------------------------------

/** Query template row from order_related_query */
export interface QueryTemplateRow {
  query_id: number;
  query_content: string;
  template_name: string;
}

/** Order query row for history display */
export interface OrderQueryRow {
  query_id: number;
  query_from: string;
  query_to: string;
  query_content: string;
  template_query: number;
  template_name: string;
  order_id: number;
  date_added: Date | string | null;
}

/** Parameters for creating an inter-admin query */
export interface CreateQueryParams {
  orderId: number;
  queryFrom: string;
  queryTo: string;         // Resolved admin_name (stored in DB)
  queryToEmail: string;    // Resolved admin_email (used for notification)
  queryContent: string;
  isTemplate: boolean;
  templateName: string;
}

/** Admin lookup row */
export interface AdminRow {
  admin_id: number;
  admin_name: string;
  admin_email: string;
}
