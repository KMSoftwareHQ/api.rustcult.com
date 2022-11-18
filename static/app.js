const pageSourceTextBox = document.getElementById('PastePageSourceHere');

pageSourceTextBox.addEventListener('input', (event) => {
    console.log(pageSourceTextBox.value);
});
