const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const request = require('request');
const Chatkit = require('@pusher/chatkit-server');
const docusign = require('docusign-esign');
const path = require('path');
const xmlParser = require('xml2js');

let loginAccount;

// Docusign info
const INTEGRATOR_KEY = 'YOUR_DOCUSIGN_INTEGRATOR_KEY'; 
const USER_ID = 'YOUR_DOCUSIGN_USERNAME_API';
const TEMPLATE_ID = 'YOUR_DOCUSIGN_TEMPLATE_ID'; 
const TEMPLATE_ROLE = 'YOUR_DOCUSIGN_TEMPLATE_ROLE';
const TOKEN_EXPIRATION_SECONDS = 3600;
// lt --subdomain YOUR_SUBDOMAIN --port 3001
const WEBHOOK_URL = 'https://YOUR_SUBDOMAIN.localtunnel.me/webhook';

const BASE_URL = 'https://demo.docusign.net/restapi';
const OAUTH_BASE_URL = 'account-d.docusign.com'; // use account.docusign.com for prod
const PRIVATE_KEY_FILE = 'keys/docusign_private_key.txt';


// Chatkit info
const CHATKIT_INSTANCE_LOCATOR = 'YOUR_CHATKIT_INSTANCE_LOCATOR';
const CHATKIT_SECRET_KEY = 'YOUR_CHATKIT_SECRET_KEY';

const CHATKIT_INSTANCE_ID = CHATKIT_INSTANCE_LOCATOR.split(':')[2];
const CHATKIT_API_URL = `https://us1.pusherplatform.io/services/chatkit/v2/${CHATKIT_INSTANCE_ID}`;

// User info (must match the users registered in Chatkit)
const users = [
  {
    id: 'YOUR_USER_ID',
    email: 'YOUR_USER_EMAIL',
    name: 'User 1',
    token: null,
    hasSigned: false,
  },
  {
    id: 'YOUR_USER_ID',
    email: 'YOUR_USER_EMAIL',
    name: 'User 2',
    token: null,
    hasSigned: false,
  }
];

const chatkit = new Chatkit.default({
  instanceLocator: CHATKIT_INSTANCE_LOCATOR,
  key: CHATKIT_SECRET_KEY 
});

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

app.post('/authenticate', (req, res) => {
  const user = users.find(u => u.id === req.query.user_id);
  
  if(user) {
    const authData = chatkit.authenticate({ userId: req.query.user_id });
    if(authData.status === 200) {
      user.token = authData.body.access_token;
    }
    res.status(authData.status).send(authData.body);
  } else {
    res.status(401).send("The user doesn't exist");
  }
});

app.post('/message/:roomID/:userID', (req, res) => {
  const {roomID, userID} = req.params;
  
  const user = users.find(u => u.id === userID);
  
  if(user) {
    if(user.hasSigned) {
      request.post({
        url: `${CHATKIT_API_URL}/rooms/${roomID}/messages`, 
        json: {text: req.body.text},
        headers: {
          'Authorization': `Bearer ${user.token}`
        }
      }, (err, httpResponse, body) => {
        res.status(httpResponse.statusCode).send(body);
      });
    } else {
      res.status(401).send({ error_description: "You haven't signed the NDA" });
    }
  } else {
    res.status(401).send({ error_description: "The user doesn't exist" });
  }
});

app.get('/sign/:userID', (req, res) => {
  const {userID} = req.params;
  
  const user = users.find(u => u.id === userID);
  
  if(user) {
    // Webhook notifications from DocuSign
    const envelopeEvents = [];
    let envelopeEvent = new docusign.EnvelopeEvent();
    envelopeEvent.envelopeEventStatusCode = 'Sent';
    envelopeEvents.push(envelopeEvent);
    envelopeEvent = new docusign.EnvelopeEvent();
    envelopeEvent.envelopeEventStatusCode = 'Completed';
    envelopeEvents.push(envelopeEvent);
    
    const recipientEvents = [];
    let recipientEvent = new docusign.RecipientEvent();
    recipientEvent.recipientEventStatusCode = 'Sent';
    recipientEvents.push(recipientEvent);
    recipientEvent = new docusign.RecipientEvent();
    recipientEvent.recipientEventStatusCode = 'Completed';
    recipientEvents.push(recipientEvent);

    const eventNotification = new docusign.EventNotification();
    eventNotification.url = WEBHOOK_URL;
    eventNotification.loggingEnabled = true;
    eventNotification.envelopeEvents = envelopeEvents;
    eventNotification.recipientEvents = recipientEvents;
    
    // create a new envelope object that we will manage the signature request through
    const envDef = new docusign.EnvelopeDefinition();
    envDef.emailSubject = 'Please sign this document to start using the chat';
    envDef.templateId = TEMPLATE_ID;
    envDef.eventNotification = eventNotification;

    // create a template role with a valid templateId and roleName and assign signer info
    const templateRole = new docusign.TemplateRole();
    templateRole.roleName = TEMPLATE_ROLE;
    templateRole.name = user.name;
    templateRole.email = user.email;

    // assign template role(s) to the envelope
    envDef.templateRoles = [templateRole];

    // send the envelope by setting |status| to 'sent'. To save as a draft set to 'created'
    envDef.status = 'sent';

    // use the |accountId| we retrieved through the Login API to create the Envelope
    const accountId = loginAccount.accountId;

    // instantiate a new EnvelopesApi object
    const envelopesApi = new docusign.EnvelopesApi();

    // call the createEnvelope() API
    envelopesApi.createEnvelope(accountId, {'envelopeDefinition': envDef}, (err, envelopeSummary, response) => {
      if (err) {
        console.log(err);
        res.status(401).send({ error_description: err });
      }
      console.log('EnvelopeSummary: ' + JSON.stringify(envelopeSummary));
      res.status(200).send({});
    });
  } else {
    res.status(401).send({ error_description: "The user doesn't exist" });
  }
});

app.post('/webhook', bodyParser.text({
	limit: '50mb',
	type: '*/xml'
}), (req, res) => {
  console.log("Webhook request body: " + JSON.stringify(req.body));
	
  xmlParser.parseString(req.body, (err, xml) => {
    if (err || !xml) {
        throw new Error("Cannot parse Connect XML results: " + err);
    }
    const envelopeStatus = xml.DocuSignEnvelopeInformation.EnvelopeStatus;
    
    if (envelopeStatus[0].Status[0] === 'Completed') {
      const email = envelopeStatus[0].RecipientStatuses[0].RecipientStatus[0].Email[0];
      console.log('Completed email: ' + email);
      const user = users.find(u => u.email === email);
      if(user) {
        user.hasSigned = true;
      }
    }
  });
  
  res.send('Received!');
});


const apiClient = new docusign.ApiClient();
apiClient.setBasePath(BASE_URL);
docusign.Configuration.default.setDefaultApiClient(apiClient);

// Get an access token and store it
apiClient.configureJWTAuthorizationFlow(path.resolve(__dirname, PRIVATE_KEY_FILE), OAUTH_BASE_URL, INTEGRATOR_KEY, USER_ID, TOKEN_EXPIRATION_SECONDS, (err, res) => {
  if (!err && res.body && res.body.access_token) {
    apiClient.getUserInfo(res.body.access_token, function (err, userInfo) {
      const baseUri = userInfo.accounts[0].baseUri;
      const accountDomain = baseUri.split('/v2');
      // below code required for production, no effect in demo (same domain)
      apiClient.setBasePath(accountDomain[0] + "/restapi");
      console.log('LoginInformation: ' + JSON.stringify(userInfo.accounts));

      loginAccount = userInfo.accounts[0];
      
      const PORT = 3001;
      app.listen(PORT, err => {
        if (err) {
          console.error(err);
        } else {
          console.log(`Running on port ${PORT}`);
        }
      });
    });
  }
});
