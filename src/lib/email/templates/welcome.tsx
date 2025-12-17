interface WelcomeTemplateProps {
    userName: string;
    dashboardUrl?: string;
}

export function WelcomeTemplate({ userName, dashboardUrl }: WelcomeTemplateProps): string {
    return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>歡迎加入</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color: #6366F1; padding: 40px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">🎉 歡迎加入！</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="font-size: 18px; color: #333333; margin: 0 0 20px;">
                嗨 <strong>${userName}</strong>，
              </p>
              
              <p style="font-size: 16px; color: #333333; line-height: 1.6; margin: 0 0 20px;">
                感謝您加入我們！我們很高興能為您服務。
              </p>
              
              <p style="font-size: 16px; color: #333333; line-height: 1.6; margin: 0 0 30px;">
                您現在可以開始使用所有功能了。
              </p>
              
              ${
                  dashboardUrl
                      ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${dashboardUrl}" 
                       style="display: inline-block; padding: 14px 40px; background-color: #6366F1; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold;">
                      前往控制台
                    </a>
                  </td>
                </tr>
              </table>
              `
                      : ""
              }
              
              <div style="background-color: #f9f9f9; border-radius: 6px; padding: 20px; margin: 30px 0;">
                <h3 style="color: #333333; margin: 0 0 15px; font-size: 18px;">快速開始：</h3>
                <ul style="color: #666666; line-height: 1.8; margin: 0; padding-left: 20px;">
                  <li>完善您的個人資料</li>
                  <li>探索功能特色</li>
                  <li>查看使用教學</li>
                </ul>
              </div>
              
              <p style="font-size: 14px; color: #666666; line-height: 1.6; margin: 30px 0 0;">
                如果您有任何問題，隨時歡迎聯繫我們的客服團隊。
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9f9f9; padding: 20px 30px; text-align: center;">
              <p style="font-size: 12px; color: #999999; margin: 0;">
                © ${new Date().getFullYear()} Your Company. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
