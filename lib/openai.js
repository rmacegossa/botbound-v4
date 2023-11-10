const { Configuration, OpenAIApi } = require("openai");

const { config } = require("../config");

const configuration = new Configuration({
  apiKey: config.openAI.apiToken,
  basePath: "https://api.openai.com/v1",
  organization: "org-pnCIStK9cr1IarO10NZDS7ZQ",
});

const openai = new OpenAIApi(configuration);

exports.openai = openai;
