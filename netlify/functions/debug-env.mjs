export async function handler() {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      NETLIFY_SITE_ID: !!process.env.NETLIFY_SITE_ID,
      NETLIFY_ACCESS_TOKEN: !!process.env.NETLIFY_ACCESS_TOKEN,
      NETLIFY_API_TOKEN: !!process.env.NETLIFY_API_TOKEN,
      SITE_ID: !!process.env.SITE_ID,
      TOKEN: !!process.env.TOKEN,
      NODE_ENV: process.env.NODE_ENV,
    }),
  };
}
