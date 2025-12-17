interface EmailVerificationTemplateProps {
    verificationUrl: string;
    userName?: string;
}

export function EmailVerificationTemplate({ verificationUrl, userName }: EmailVerificationTemplateProps): string {
    return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>驗證您的電子郵件</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color: #10B981; padding: 40px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px;">驗證您的電子郵件</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              ${userName ? `<p style="font-size: 16px; color: #333333; margin: 0 0 20px;">嗨 ${userName}，</p>` : ""}
              
              <p style="font-size: 16px; color: #333333; line-height: 1.6; margin: 0 0 20px;">
                感謝您註冊！請點擊下方按鈕來驗證您的電子郵件地址：
              </p>
              
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${verificationUrl}" 
                       style="display: inline-block; padding: 14px 40px; background-color: #10B981; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold;">
                      驗證電子郵件
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="font-size: 14px; color: #666666; line-height: 1.6; margin: 20px 0 0;">
                如果按鈕無法點擊，請複製以下連結到瀏覽器：<br>
                <a href="${verificationUrl}" style="color: #10B981; word-break: break-all;">${verificationUrl}</a>
              </p>
              
              <p style="font-size: 14px; color: #666666; line-height: 1.6; margin: 20px 0 0;">
                此連結將在 <strong>24 小時後</strong>失效。
              </p>
              
              <p style="font-size: 14px; color: #999999; line-height: 1.6; margin: 30px 0 0; padding-top: 20px; border-top: 1px solid #eeeeee;">
                如果您沒有註冊此帳號，請忽略此郵件。
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
