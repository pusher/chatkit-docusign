import React, { Component } from 'react'
import UsernameForm from './components/UsernameForm'
import ChatScreen from './ChatScreen'
import Chatkit from '@pusher/chatkit-client'

const CHATKIT_INSTANCE_LOCATOR = 'YOUR_CHATKIT_INSTANCE_LOCATOR';
const SERVER_URL = 'http://localhost:3001';

class App extends Component {
  constructor() {
    super()
    this.state = {
      currentUser: null,
      currentScreen: 'WhatIsYourUsernameScreen',
    }
    this.onUsernameSubmitted = this.onUsernameSubmitted.bind(this)
  }

  onUsernameSubmitted(username, password) {
    const chatManager = new Chatkit.ChatManager({
      instanceLocator: CHATKIT_INSTANCE_LOCATOR,
      userId: username,
      tokenProvider: new Chatkit.TokenProvider({
        url: `${SERVER_URL}/authenticate`,
      }),
    })
    chatManager
      .connect()
      .then(user => {
        this.setState({
          currentUser: user,
          currentScreen: 'ChatScreen',
        })
      })
      .catch(error => alert(error.info))
  }
  render() {
    if (this.state.currentScreen === 'WhatIsYourUsernameScreen') {
      return <UsernameForm onSubmit={this.onUsernameSubmitted} />
    }
    if (this.state.currentScreen === 'ChatScreen') {
      return <ChatScreen currentUser={this.state.currentUser} />
    }
  }
}

export default App
