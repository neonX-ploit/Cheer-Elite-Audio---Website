// Shared mutable state across modules
export const state = {
  activeChatId:  null,
  unsubMessages: null,
  unsubOrders:   null,
  unsubChats:    null,
  allChats:      [],
  activeAudio:   null,
  currentPage:   'chats',
  pendingAction: null,
  adminName: 'Support',
};