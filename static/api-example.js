async function Main() {
    const response = await fetch('https://api.rustgovernment.com', {
	credentials: 'include',
    });
    console.log(response);
    const data = await response.json();
    console.log(data);
}

Main();
