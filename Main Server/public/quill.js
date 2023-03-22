const Delta = Quill.import('delta');
const editor = new Quill('#editor', {
    modules: { toolbar: '#toolbar' },
    theme: 'snow',
});

var version;
var transformation = null;
var free = true;
var first = true;

const queue = [];

//Need to fix version on frontend and version on backend
const docid = window.location.pathname.split("/").pop()
const uid = Date.now();
console.log(uid);
const evtSource = new EventSource('http://zero-and-one.cse356.compas.cs.stonybrook.edu/doc/connect/' + docid + "/" + uid);
// const evtSource = new EventSource('http://localhost:3000/connect/' + id);
evtSource.onmessage = function(event) {
    const parsedData = JSON.parse(event.data);
    console.log(parsedData);
    if(parsedData.content && parsedData.version) {
        version = parsedData.version;
        editor.updateContents(new Delta(parsedData.content));
    } else if(parsedData.ack) {
        version++;
        free = true;
        console.log(transformation);
        // transformation = null;
    } else if(parsedData.presence) {

    } else {
        const firstDelta = new Delta(parsedData);
        if(transformation) {
            transformation = firstDelta.transform(transformation, true);
            editor.updateContents(transformation.transform(firstDelta, true));
        } else {
            editor.updateContents(firstDelta);
        }
        version++;
        sendRequest();
    }
}
evtSource.onerror = function(err) {
    console.error("EventSource failed:", err);
  };

//'http://localhost:3000/op/' + id
editor.on('text-change', function(delta, oldDelta, source) {
    // console.log(delta, source);

    if (source !== 'user') return;
    // const server = new Delta([{retain : 3}, {insert : "H"}]);
    // var one = new Delta([{retain : 3}, {insert : "H"}]);
    // var two = new Delta([{retain : 3}, {insert : "H"}]);
    // queue.push(delta);
    // console.log(queue.map(delta => server.transform(delta, false))); //FOR SERVER-SIDE
    //console.log(queue);
    
    // for(let i = 0; i < queue.length; i++) {
    //     one = queue[i].transform(one, false);
    // }
    // console.log(one);


    // var check = queue[0];
    // for(let i = 1; i < queue.length; i++) {
    //     check = check.compose(queue[i]);
    // }
    // //console.log(check);
    // console.log(check.transform(two, false));

    // if(free) {
    //     sendRequest();
    // } 
    if(transformation) {
        transformation = transformation.compose(delta);
    } else {
        transformation = delta;
    }
    if(free) {
        sendRequest();
    }
});

// editor.on('selection-change', function(range, oldRange, source) {
//     if (source !== 'user') return;
//     fetch('http://zero-and-one.cse356.compas.cs.stonybrook.edu/doc/presence/' + docid + "/" + uid, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify(range),
//     });
// });

function sendRequest() {
    if(transformation) {
        const test = transformation;
        transformation = null;
        free = false;
        fetch('http://zero-and-one.cse356.compas.cs.stonybrook.edu/doc/op/' + docid + "/" + uid, {
            method: 'POST',
            headers: {
            'Content-Type': 'application/json',
            },
            body: JSON.stringify({version : version, op : test}),
        }).then(response => response.json()).then(data => {
            if(data.status === "retry") {
                if(transformation) {
                    transformation = test.compose(transformation);
                } else {
                    transformation = test;
                }
            } 
        });
    };
    // if(queue.length > 0) {
    //     free = false;
    //     fetch('http://zero-and-one.cse356.compas.cs.stonybrook.edu/doc/op/' + docid + "/" + uid, {
    //         method: 'POST',
    //         headers: {
    //         'Content-Type': 'application/json',
    //         },
    //         body: JSON.stringify({version : version, op : queue[0]}),
    //     })
        // .then(response => response.json()).then(data => {
        //     if(data.status === "retry") {
        //         if(transformation) {
        //             transformation = test.compose(transformation);
        //         } else {
        //             transformation = test;
        //         }
        //     } 
        // });
    // };
};

