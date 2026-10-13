//! Adapt app-owned context to chat templates that permit one opening system turn.
use rig_core::completion::Message;

pub(super) fn merge_system_messages(history: &mut Vec<Message>) {
    let mut instructions = Vec::new();
    history.retain(|message| {
        if let Message::System { content } = message {
            instructions.push(content.clone());
            false
        } else {
            true
        }
    });
    if !instructions.is_empty() {
        // Keep app context as system content, preserving its order and the
        // relative order of all dialogue/tool messages. Do this after Rig adds
        // formatter instructions, before context admission and measurement.
        history.insert(0, Message::system(instructions.join("\n\n")));
    }
}
