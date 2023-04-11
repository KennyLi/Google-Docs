const Delta = Quill.import('delta');
const editor = new Quill('#editor', {
    modules: { toolbar: '#toolbar' },
    theme: 'snow',
});


const queue = [];
const uid = Date.now();
let free = true;
let version = 1;

const evtSource = new EventSource('http://localhost:3000/connect/' + uid);
//const evtSource = new EventSource('http://test.emailgravely.com/connect/' + uid);
evtSource.onmessage = function(event) {
    const parsedData = JSON.parse(event.data);
    console.log(parsedData);
    if(parsedData.content && parsedData.version) {
        version = parsedData.version;
        console.log(version)
        editor.updateContents(new Delta(parsedData.content));
    } else if(parsedData.ack) {
        ack = JSON.stringify(parsedData.ack);
        peek = JSON.stringify(queue[0].ops);
        if(ack === peek) {
            version++;
            queue.shift();
            free = true;
            sendRequest();
        } else {
            console.log("this shouldn't happen!");
            console.log(ack);
            console.log(peek);
        }
    } else {
        const incoming = new Delta(parsedData);
        if(queue.length !== 0) {
            const composed = queue.reduce((total, delta) => total.compose(delta));
            editor.updateContents(composed.transform(incoming, false));
            queue.forEach((delta, index) => queue[index] = incoming.transform(delta, true));
        } else {
            editor.updateContents(incoming);
        }
        version++;
        free = true;
        sendRequest();
    }
}

evtSource.onerror = function(err) {
    console.error("EventSource failed:", err);
};

editor.on('text-change', function(delta, oldDelta, source) {
    if (source !== 'user') return;
    queue.push(delta);
    sendRequest();
});

function sendRequest() {
    if(free && queue.length !== 0) {
        const op = queue[0];
        fetch('http://localhost:3000/op/'+ uid, {
        //fetch('http://test.emailgravely.com/op/'+ uid, {
            method: 'POST',
            headers: {
            'Content-Type': 'application/json',
            },
            body: JSON.stringify({op : op, version : version}),
        })
        free = false;
    }
};


// function test() {
    // const one = new Delta([{retain:55}, {insert:'H'}])
    // const two = new Delta([{retain:56}, {insert:'e'}])
    // const three = new Delta([{retain:57}, {insert:'l'}])
    // const four = new Delta([{retain:58}, {insert:'l'}])
    // const five = new Delta([{retain:59}, {insert:'o'}])
    // const list = [one, two, three, four, five]
    // const incoming = new Delta([{retain:80}, {insert:'NEW'}])
    // list.map(delta => incoming.transform(delta));
    // console.log(list)
    // const composed = list.reduce((total, delta) => total.compose(delta));
    // console.log(composed)
    // const compose = one.compose(two).compose(three).compose(four).compose(five);
    // console.log(incoming.transform(compose)); //queue happened first, transform queue to account for incoming THIS STATEMENT IS APPLIED TO EACH QUEUE ELEMENT
    // console.log(compose.transform(incoming)); //incoming happened first, transform incoming to account for queue
    // const one = new Delta([{insert:'H'}]);
    // const two = new Delta([{insert:'P'}]);
    // console.log(one.transform(two, false));
    // console.log(one.transform(two, true));
    // console.log(two.transform(one, false));
    // console.log(two.transform(one, true));
//}

//test();

let run = false;
function toggle() {
    run = !run;
    const text = run ? "ON" : "OFF"
    const element = document.getElementById("toggle");
    element.innerHTML = "Automatic Typing: " + text;
}

setInterval(function() {
    if(run) {
        const newDelta = new Delta([{retain: Math.floor(Math.random() * 1000) + 1}, {insert: '0'}], {source : "test"});
        editor.updateContents(newDelta);
        queue.push(newDelta);
        sendRequest();
    }
}, Math.floor(Math.random() * 200) + 500);