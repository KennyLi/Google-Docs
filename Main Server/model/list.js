const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const listSchema = new Schema({
    docs: [{
        type: String,
        required: true,
    }],
    id:{
        type: String,
    }
});

module.exports = mongoose.model('list', listSchema);