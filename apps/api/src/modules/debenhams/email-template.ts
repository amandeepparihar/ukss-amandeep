/**
 * Base HTML template wrapper (matching email-templates.ts style)
 */
const baseHtml = (content: string, title: string = 'Admin Panel') => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
  <div style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    ${content}
  </div>
  <p style="text-align: center; color: #666; font-size: 12px; margin-top: 20px;">
    &copy; ${new Date().getFullYear()} Admin Panel. All rights reserved.
  </p>
</body>
</html>
`;

/**
 * Header component (matching email-templates.ts style)
 */
const header = (title: string, color: string = '#667eea') => `
<div style="background: linear-gradient(135deg, ${color} 0%, #764ba2 100%); padding: 30px 20px; text-align: center;">
  <h1 style="color: white; margin: 0; font-size: 24px;">${title}</h1>
</div>
`;

/**
 * Button component (matching email-templates.ts style)
 */
const button = (text: string, url: string, color: string = '#667eea') => `
<div style="text-align: center; margin: 30px 0;">
  <a href="${url}" style="background: ${color}; color: white; padding: 14px 35px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">${text}</a>
</div>
`;

/**
 * Footer divider
 */
const divider = `<hr style="border: none; border-top: 1px solid #eee; margin: 30px 20px;">`;

export const cancelDebenhamsOrderLinesEmailTemplate = (orderId: string, sellerPanelUrl: string, ukssEditOrderUrl: string) => {
  return baseHtml(`
    ${header('Debenhams Order Cancellation Required', '#e74c3c')}
    <div style="padding: 30px 20px;">
      <p style="margin: 0 0 15px;">Hello,</p>
      <p style="margin: 0 0 20px;">This is to notify you that Debenhams order lines have been cancelled and require manual processing for refund.</p>
      
      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0 0 10px; font-weight: bold; color: #856404;">Action Required:</p>
        <p style="margin: 0; color: #856404;">Please cancel the order manually in the Debenhams seller panel and process the refund.</p>
      </div>
      
      <div style="background: #f8f9fa; border-left: 4px solid #e74c3c; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0 0 10px; font-weight: bold; color: #495057;">Order ID:</p>
        <p style="margin: 0; color: #495057; font-family: monospace; font-size: 13px; word-break: break-all;">${orderId}</p>
      </div>
      
      ${button('View Order in Seller Panel', sellerPanelUrl, '#e74c3c')}
      ${button('View Order in UKSS Admin Panel', ukssEditOrderUrl, '#e74c3c')}
      
      ${divider}
      <p style="font-size: 12px; color: #999; margin: 0;">If the button doesn't work, copy and paste this link: ${sellerPanelUrl}</p>
      <p style="font-size: 12px; color: #999; margin: 10px 0 0;">If the button doesn't work, copy and paste this link: ${ukssEditOrderUrl}</p>
      <p style="font-size: 12px; color: #999; margin: 10px 0 0;">This is an automated notification from the Debenhams Order Management System.</p>
    </div>
  `);
}