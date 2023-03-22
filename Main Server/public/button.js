var buttons = document.getElementsByClassName("deleteButton");

for(var i = 0; i < buttons.length; i++){
    const button = buttons[i];
    let data = { docid: button.value };
    button.addEventListener("click", function() {
        fetch("/collection/delete", {
            method: "POST",
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify(data)
          }).then(res => {
              location.reload();
          });
    });
}