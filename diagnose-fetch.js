// Run this in your browser console to diagnose the fetch issue
// Open DevTools (F12) → Console tab → Paste this code → Press Enter

(async () => {
  console.log('🔍 Diagnosing fetch issue...\n');
  
  // Check if fetch is wrapped
  console.log('1. Checking if fetch is wrapped by extension:');
  console.log('   fetch.toString():', fetch.toString().substring(0, 100));
  console.log('   Is native?', fetch.toString().includes('[native code]'));
  
  // Test the endpoint
  console.log('\n2. Testing endpoint directly:');
  try {
    const response = await fetch('https://fqyybbrgeeugbwunxvfs.supabase.co/rest/v1/rpc/create_task_with_recurrence', {
      method: 'POST',
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxeXliYnJnZWV1Z2J3dW54dmZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NDEwODEsImV4cCI6MjA5MzIxNzA4MX0.LwOpBB_AU-EMQNkQdc9C0z_Xz3XO7dxcRzgEkSMCdRM',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        p_organization_id: '00000000-0000-0000-0000-000000000000',
        p_title: 'Diagnostic Test',
        p_status: 'planned',
        p_priority: 'low',
        p_assignee_ids: [],
        p_mentioned_member_ids: []
      })
    });
    
    console.log('   Status:', response.status);
    console.log('   Status Text:', response.statusText);
    console.log('   Headers:', Object.fromEntries(response.headers.entries()));
    
    const data = await response.json();
    console.log('   Response:', data);
    
    if (response.status === 404) {
      console.log('\n❌ PROBLEM: Getting 404 in browser');
      console.log('   This suggests:');
      console.log('   - Browser extension is interfering');
      console.log('   - Or browser cache is stuck');
      console.log('\n   Solutions:');
      console.log('   1. Disable all browser extensions');
      console.log('   2. Try incognito mode');
      console.log('   3. Clear site data (DevTools → Application → Clear site data)');
    } else if (response.status === 403) {
      console.log('\n✅ SUCCESS: Endpoint is working!');
      console.log('   403 = Authentication required (expected)');
      console.log('   The endpoint exists and is accessible.');
    }
  } catch (error) {
    console.error('   Error:', error);
  }
  
  // Check for service workers
  console.log('\n3. Checking for service workers:');
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    console.log('   Service workers:', registrations.length);
    registrations.forEach(reg => console.log('   -', reg.scope));
  }
  
  // Check cache storage
  console.log('\n4. Checking cache storage:');
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    console.log('   Caches:', cacheNames);
  }
  
  console.log('\n✅ Diagnosis complete!');
})();
