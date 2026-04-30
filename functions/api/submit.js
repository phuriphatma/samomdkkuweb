export async function onRequestPost(context) {
  try {
    // Read the data sent from your HTML form
    const formData = await context.request.json();
    
    // Read your secure Google Apps Script URL from Cloudflare's Environment Variables
    const GAS_URL = context.env.GAS_WEBHOOK_URL; 

    // Forward the data to Google Apps Script
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    const result = await response.json();
    
    // Send the result back to the website
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: 'Server Error' }), { status: 500 });
  }
}