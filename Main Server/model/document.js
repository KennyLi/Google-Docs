const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const documentSchema = new Schema({
    name: {
        type: String,
        required: true,
    },
    docID: {
        type: String,
        required: true,
        unique: true,
    },
});

module.exports = mongoose.model('document', documentSchema);