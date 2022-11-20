let animatedEllipsis = '...';
setInterval(() => {
    if (animatedEllipsis.length >= 3) {
	animatedEllipsis = '.';
    } else {
	animatedEllipsis += '.';
    }
}, 500);

const pageSourceTextBox = document.getElementById('PastePageSourceHere');
const serverPairingStatusLabel = document.getElementById('ServerPairingStatus');

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
    const textResponse = JSON.stringify(jsonResponse);
    serverPairingStatusLabel.innerHTML = textResponse;
    UpdateServerPairingRequestStatus();
});

async function UpdateServerPairingRequestStatus() {
    // Call the /pair endpoint with no options to get a status update.
    const emptyRequest = {};
    const response = await fetch('/pair', {
	method: 'post',
	headers: {
	    'Content-Type': 'application/json',
	},
	body: JSON.stringify(emptyRequest),
    });
    const jsonResponse = await response.json();
    console.log(jsonResponse);
    const textResponse = JSON.stringify(jsonResponse);
    serverPairingStatusLabel.innerHTML = textResponse;
    if (jsonResponse.status && jsonResponse.status !== 'No pairing request underway') {
	setTimeout(UpdateServerPairingRequestStatus, 1000);
    }
}
