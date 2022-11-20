const pageSourceTextBox = document.getElementById('PastePageSourceHere');

pageSourceTextBox.addEventListener('input', async (event) => {
    const pageSource = pageSourceTextBox.value;
    const serverPairingRequest = { pageSource };
    const response = await fetch('/pair', {
	method: 'post',
	headers: {
	    'Content-Type': 'application/json',
	},
	body: JSON.stringify(serverPairingRequest),
    });
    const jsonResponse = await response.json();
    console.log(jsonResponse);
});
