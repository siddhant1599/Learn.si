/** The docs home page's "Privacy at a glance" section (covers both modes). */
export const privacySummary = [
  { title: "Your local workspace", text: "Study Buddy runs on your machine without an account. Provider keys stay on the backend. There is no authentication: keep the servers on localhost. Documents and questions can be sent to configured external providers; local does not mean offline." },
  { title: "Evidence stays distinguishable", text: "Ask labels document and web findings separately. Web URLs, excerpts and generated web findings are excluded from saved conversations and browser history. Master uses only the course document and never searches the web." },
  { title: "Learning you can return to", text: "Document text and Ask chats are saved. Courses, generated lessons, quiz attempts, Your turn answers and tutor chats are stored in PostgreSQL. Original upload files are not retained. External providers have their own retention policies." },
  { title: "Delete when you choose", text: "You can delete chats, sources and courses with confirmation. Deleting a course keeps its source; deleting a source also removes its course. Historical Ask chats remain and must be deleted separately. Failed vector cleanup is reported for retry." },
];
