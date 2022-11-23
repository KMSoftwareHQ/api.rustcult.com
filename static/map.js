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

let serverPairingRequestUnderway = false;

pageSourceTextBox.addEventListener('input', async (event) => {
    // Only one server pairing request in-flight at a time.
    if (serverPairingRequestUnderway) {
	return;
    }
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
    UpdateStatusLabel(jsonResponse);
    if (jsonResponse.status) {
	serverPairingRequestUnderway = true;
    }
});

// Regularly poll the /pair endpoint to update the server pairing status.
// But only if there is a pairing request underway. The polling is done
// in this global way to make there be one pairing request at a time.
setInterval(async () => {
    if (!serverPairingRequestUnderway) {
	return;
    }
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
    UpdateStatusLabel(jsonResponse);
    if (!jsonResponse.status) {
	serverPairingRequestUnderway = false;
    }
}, 500);

function UpdateStatusLabel(jsonResponse) {
    if (jsonResponse.error) {
	serverPairingStatusLabel.innerHTML = jsonResponse.error;
	serverPairingStatusLabel.style.color = 'red';
    } else if (jsonResponse.status) {
	serverPairingStatusLabel.innerHTML = jsonResponse.status;
	serverPairingStatusLabel.style.color = 'blue';
    } else if (jsonResponse.success) {
	serverPairingStatusLabel.innerHTML = jsonResponse.success;
	serverPairingStatusLabel.style.color = 'green';
    }
}
